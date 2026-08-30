/**
 * Harness Preview Server manager.
 *
 * Owns one Metro (`expo start --dev-client`) process per thread so a harness
 * build of the mobile app can load that thread's project. Lifecycle:
 *
 * - `startServer` resolves the thread's workspace cwd, spawns Metro on a free
 *   port, and waits for readiness (Metro printing its "Waiting on" line).
 * - `stopServer` closes the per-server scope, which kills the process group.
 * - `start` (the reactor) subscribes to orchestration events so settling a
 *   thread stops its server, and runs the idle reaper: a server with no
 *   Metro bundle activity for IDLE_TIMEOUT is stopped.
 *
 * On macOS a single `caffeinate` process is held while at least one preview
 * server runs, so the machine stays awake for phones previewing remotely.
 */
import type {
  HarnessPreviewError,
  HarnessPreviewListInput,
  HarnessPreviewListResult,
  HarnessPreviewServerSnapshot,
  HarnessPreviewStartInput,
  HarnessPreviewStopInput,
  OrchestrationEvent,
  ThreadId,
} from "@t3tools/contracts";
import {
  HarnessPreviewCwdUnavailableError,
  HarnessPreviewSpawnError,
  HarnessPreviewThreadNotFoundError,
} from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as NodeOS from "node:os";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { resolveThreadWorkspaceCwd } from "../checkpointing/Utils.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { forkParked } from "../serverActivation.ts";

export class HarnessPreviewManager extends Context.Service<
  HarnessPreviewManager,
  {
    readonly startServer: (
      input: HarnessPreviewStartInput,
    ) => Effect.Effect<HarnessPreviewServerSnapshot, HarnessPreviewError>;
    readonly stopServer: (input: HarnessPreviewStopInput) => Effect.Effect<void>;
    readonly list: (input: HarnessPreviewListInput) => Effect.Effect<HarnessPreviewListResult>;
    /** Reactor entry: settle hook + idle reaper. Forked under the caller's scope. */
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/harness/Manager/HarnessPreviewManager") {}

/** A server without Metro bundle activity for this long is reaped. */
const IDLE_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const REAPER_INTERVAL = "10 minutes";
const READY_TIMEOUT_MS = 120_000;

interface ServerState {
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly port: number;
  readonly lanUrl: string | undefined;
  readonly tailnetUrl: string | undefined;
  readonly status: "starting" | "running" | "failed";
  readonly startedAt: string;
  readonly scope: Scope.Closeable;
  /** Epoch ms of the last Metro bundle log line; reaper input. */
  readonly lastActivity: Ref.Ref<number>;
}

/** Tailscale assigns from the CGNAT range 100.64.0.0/10. */
const isTailnetAddress = (address: string): boolean => {
  const octets = address.split(".").map(Number);
  return octets[0] === 100 && octets[1] !== undefined && octets[1] >= 64 && octets[1] <= 127;
};

const isPrivateLanAddress = (address: string): boolean =>
  address.startsWith("192.168.") ||
  address.startsWith("10.") ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(address);

const resolveAdvertisedHosts = (): { lan: string | undefined; tailnet: string | undefined } => {
  let lan: string | undefined;
  let tailnet: string | undefined;
  for (const addresses of Object.values(NodeOS.networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (tailnet === undefined && isTailnetAddress(entry.address)) tailnet = entry.address;
      else if (lan === undefined && isPrivateLanAddress(entry.address)) lan = entry.address;
    }
  }
  return { lan, tailnet };
};

const currentIsoTimestamp = DateTime.now.pipe(Effect.map(DateTime.formatIso));

const toSnapshot = (server: ServerState, lastActivityMs: number): HarnessPreviewServerSnapshot => ({
  threadId: server.threadId,
  cwd: server.cwd,
  port: server.port,
  ...(server.lanUrl !== undefined ? { lanUrl: server.lanUrl } : {}),
  ...(server.tailnetUrl !== undefined ? { tailnetUrl: server.tailnetUrl } : {}),
  status: server.status,
  startedAt: server.startedAt,
  lastActivityAt: DateTime.formatIso(DateTime.makeUnsafe(lastActivityMs)),
});

export const make = Effect.gen(function* HarnessPreviewManagerMake() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const hostPlatform = yield* HostProcessPlatform;
  const netService = yield* NetService.NetService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const fileSystem = yield* FileSystem.FileSystem;

  const stateRef = yield* SynchronizedRef.make<ReadonlyMap<ThreadId, ServerState>>(new Map());
  /** Scope holding the macOS `caffeinate` child while any server runs. */
  const awakeScopeRef = yield* Ref.make<Option.Option<Scope.Closeable>>(Option.none());

  yield* Effect.addFinalizer(() =>
    SynchronizedRef.get(stateRef).pipe(
      Effect.flatMap((servers) =>
        Effect.forEach(servers.values(), (server) => Scope.close(server.scope, Exit.void), {
          discard: true,
        }),
      ),
      Effect.andThen(releaseAwakeLock()),
      Effect.ignore,
    ),
  );

  function acquireAwakeLock(): Effect.Effect<void> {
    return Effect.gen(function* () {
      if (hostPlatform !== "darwin") return;
      const existing = yield* Ref.get(awakeScopeRef);
      if (Option.isSome(existing)) return;
      const scope = yield* Scope.make("sequential");
      yield* spawner
        .spawn(ChildProcess.make("caffeinate", ["-dims"], {}))
        .pipe(Effect.provideService(Scope.Scope, scope))
        .pipe(Effect.ignore);
      yield* Ref.set(awakeScopeRef, Option.some(scope));
    });
  }

  function releaseAwakeLock(): Effect.Effect<void> {
    return Ref.getAndSet(awakeScopeRef, Option.none()).pipe(
      Effect.flatMap((scope) =>
        Option.isSome(scope) ? Scope.close(scope.value, Exit.void) : Effect.void,
      ),
      Effect.ignore,
    );
  }

  const resolveCwd = Effect.fn("HarnessPreviewManager.resolveCwd")(function* (threadId: ThreadId) {
    const notFound = () => new HarnessPreviewThreadNotFoundError({ threadId });
    const thread = yield* projectionSnapshotQuery
      .getThreadShellById(threadId)
      .pipe(
        Effect.mapError(notFound),
        Effect.flatMap(
          Option.match({ onNone: () => Effect.fail(notFound()), onSome: Effect.succeed }),
        ),
      );
    const project = yield* projectionSnapshotQuery
      .getProjectShellById(thread.projectId)
      .pipe(Effect.mapError(notFound), Effect.map(Option.getOrUndefined));
    const cwd = resolveThreadWorkspaceCwd({
      thread,
      projects: project ? [project] : [],
    });
    if (cwd === undefined) {
      return yield* Effect.fail(notFound());
    }
    const cwdExists = yield* fileSystem.exists(cwd).pipe(Effect.orElseSucceed(() => false));
    if (!cwdExists) {
      return yield* Effect.fail(new HarnessPreviewCwdUnavailableError({ threadId, cwd }));
    }
    return cwd;
  });

  /** Spawn Metro in `cwd`, resolve once it logs readiness, keep watching for bundle activity. */
  const spawnMetro = Effect.fn("HarnessPreviewManager.spawnMetro")(function* (input: {
    readonly threadId: ThreadId;
    readonly cwd: string;
    readonly port: number;
    readonly scope: Scope.Closeable;
    readonly lastActivity: Ref.Ref<number>;
  }) {
    const { threadId, cwd, port, scope, lastActivity } = input;
    const child = yield* spawner
      .spawn(
        ChildProcess.make(
          "npx",
          ["expo", "start", "--dev-client", "--port", String(port), "--lan"],
          {
            cwd,
            detached: hostPlatform !== "win32",
            // T3CODE_HARNESS_PREVIEW lets a project's metro.config detect it
            // is being bundled for the harness (e.g. to stub out native
            // modules the harness does not compile in, like Firebase).
            env: { CI: "1", EXPO_NO_TELEMETRY: "1", T3CODE_HARNESS_PREVIEW: "1" },
            extendEnv: true,
          },
        ),
      )
      .pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.mapError(
          (cause) =>
            new HarnessPreviewSpawnError({
              threadId,
              detail: `Failed to spawn Metro: ${Cause.isCause(cause) ? Cause.pretty(cause) : String(cause)}`,
            }),
        ),
      );

    const killProcessGroup = (signal: NodeJS.Signals) =>
      hostPlatform === "win32"
        ? child.kill({ killSignal: signal, forceKillAfter: "1 second" }).pipe(Effect.asVoid)
        : Effect.sync(() => {
            try {
              process.kill(-Number(child.pid), signal);
            } catch {
              // Best-effort: the group may already be gone.
            }
          });
    yield* Scope.addFinalizer(
      scope,
      killProcessGroup("SIGTERM").pipe(
        Effect.andThen(Effect.sleep("1 second")),
        Effect.andThen(killProcessGroup("SIGKILL")),
        Effect.ignore,
      ),
    );

    const readyDeferred = yield* Deferred.make<void, HarnessPreviewSpawnError>();
    const stderrTail = yield* Ref.make("");

    const noteChunk = (chunk: string) =>
      Effect.gen(function* () {
        if (chunk.includes("Waiting on http://")) {
          yield* Deferred.succeed(readyDeferred, undefined).pipe(Effect.ignore);
        }
        if (/Bundl/i.test(chunk)) {
          yield* Ref.set(lastActivity, yield* Clock.currentTimeMillis);
        }
      });

    yield* child.stdout.pipe(
      Stream.decodeText(),
      Stream.runForEach(noteChunk),
      Effect.ignore,
      Effect.forkIn(scope),
    );
    yield* child.stderr.pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) =>
        Ref.update(stderrTail, (tail) => `${tail}${chunk}`.slice(-4000)),
      ),
      Effect.ignore,
      Effect.forkIn(scope),
    );
    yield* child.exitCode.pipe(
      Effect.flatMap((code) =>
        Ref.get(stderrTail).pipe(
          Effect.flatMap((stderr) =>
            Deferred.fail(
              readyDeferred,
              new HarnessPreviewSpawnError({
                threadId,
                detail: [
                  `Metro exited before startup completed (code ${String(Number(code))}).`,
                  stderr.trim() ? `stderr:\n${stderr.trim()}` : null,
                ]
                  .filter(Boolean)
                  .join("\n"),
              }),
            ).pipe(Effect.ignore),
          ),
        ),
      ),
      Effect.ignore,
      Effect.forkIn(scope),
    );

    const ready = yield* Deferred.await(readyDeferred).pipe(Effect.timeoutOption(READY_TIMEOUT_MS));
    if (Option.isNone(ready)) {
      return yield* Effect.fail(
        new HarnessPreviewSpawnError({
          threadId,
          detail: `Timed out waiting for Metro startup after ${String(READY_TIMEOUT_MS)}ms.`,
        }),
      );
    }
  });

  const stopServer: HarnessPreviewManager["Service"]["stopServer"] = Effect.fn(
    "HarnessPreviewManager.stopServer",
  )(function* (input) {
    const removed = yield* SynchronizedRef.modify(stateRef, (servers) => {
      const server = servers.get(input.threadId);
      if (!server) return [undefined, servers] as const;
      const next = new Map(servers);
      next.delete(input.threadId);
      return [server, next as ReadonlyMap<ThreadId, ServerState>] as const;
    });
    if (removed) {
      yield* Scope.close(removed.scope, Exit.void).pipe(Effect.ignore);
    }
    const remaining = yield* SynchronizedRef.get(stateRef);
    if (remaining.size === 0) {
      yield* releaseAwakeLock();
    }
  });

  const startServer: HarnessPreviewManager["Service"]["startServer"] = Effect.fn(
    "HarnessPreviewManager.startServer",
  )(function* (input) {
    const existing = (yield* SynchronizedRef.get(stateRef)).get(input.threadId);
    if (existing && existing.status !== "failed") {
      return toSnapshot(existing, yield* Ref.get(existing.lastActivity));
    }
    if (existing) {
      yield* stopServer({ threadId: input.threadId });
    }

    const cwd = yield* resolveCwd(input.threadId);
    const port = yield* netService.findAvailablePort(0).pipe(
      Effect.mapError(
        (cause) =>
          new HarnessPreviewSpawnError({
            threadId: input.threadId,
            detail: `No available port: ${String(cause)}`,
          }),
      ),
    );
    const hosts = resolveAdvertisedHosts();
    const startedAt = yield* currentIsoTimestamp;
    const lastActivity = yield* Ref.make(yield* Clock.currentTimeMillis);
    const scope = yield* Scope.make("sequential");

    const server: ServerState = {
      threadId: input.threadId,
      cwd,
      port,
      lanUrl: hosts.lan !== undefined ? `http://${hosts.lan}:${String(port)}` : undefined,
      tailnetUrl:
        hosts.tailnet !== undefined ? `http://${hosts.tailnet}:${String(port)}` : undefined,
      status: "starting",
      startedAt,
      scope,
      lastActivity,
    };
    yield* SynchronizedRef.update(stateRef, (servers) => {
      const next = new Map(servers);
      next.set(input.threadId, server);
      return next as ReadonlyMap<ThreadId, ServerState>;
    });

    yield* spawnMetro({ threadId: input.threadId, cwd, port, scope, lastActivity }).pipe(
      Effect.onError(() => stopServer({ threadId: input.threadId })),
    );

    const running: ServerState = { ...server, status: "running" };
    yield* SynchronizedRef.update(stateRef, (servers) => {
      const next = new Map(servers);
      next.set(input.threadId, running);
      return next as ReadonlyMap<ThreadId, ServerState>;
    });
    yield* acquireAwakeLock();
    return toSnapshot(running, yield* Ref.get(lastActivity));
  });

  const list: HarnessPreviewManager["Service"]["list"] = Effect.fn("HarnessPreviewManager.list")(
    function* (_input) {
      const servers = yield* SynchronizedRef.get(stateRef);
      const snapshots: HarnessPreviewServerSnapshot[] = [];
      for (const server of servers.values()) {
        snapshots.push(toSnapshot(server, yield* Ref.get(server.lastActivity)));
      }
      return {
        servers: snapshots.toSorted((a, b) => a.startedAt.localeCompare(b.startedAt)),
      };
    },
  );

  const reapIdleServers = Effect.gen(function* () {
    const servers = yield* SynchronizedRef.get(stateRef);
    const now = yield* Clock.currentTimeMillis;
    for (const server of servers.values()) {
      const lastActivity = yield* Ref.get(server.lastActivity);
      if (server.status === "running" && now - lastActivity > IDLE_TIMEOUT_MS) {
        yield* Effect.logInfo("harness preview server idle; reaping", {
          threadId: server.threadId,
          idleMs: now - lastActivity,
        });
        yield* stopServer({ threadId: server.threadId });
      }
    }
  });

  const onSettled = (event: OrchestrationEvent) =>
    event.type === "thread.settled"
      ? stopServer({ threadId: event.payload.threadId }).pipe(Effect.ignore)
      : Effect.void;

  const start: HarnessPreviewManager["Service"]["start"] = Effect.fn("start")(function* () {
    yield* forkParked(Stream.runForEach(orchestrationEngine.streamDomainEvents, onSettled));
    yield* forkParked(
      reapIdleServers.pipe(Effect.ignore, Effect.repeat(Schedule.spaced(REAPER_INTERVAL))),
    );
  });

  return HarnessPreviewManager.of({ startServer, stopServer, list, start });
}).pipe(Effect.withSpan("HarnessPreviewManager.make"));

export const layer = Layer.effect(HarnessPreviewManager, make);
