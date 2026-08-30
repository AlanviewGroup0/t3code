import type { OrchestrationEvent, ProjectId, ThreadId } from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schedule from "effect/Schedule";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { expect } from "vite-plus/test";

import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../orchestration/Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { HarnessPreviewManager, make } from "./Manager.ts";

const threadId = "thread-harness-1" as ThreadId;
const projectId = "project-harness-1" as ProjectId;
const workspaceRoot = "/tmp/harness-test-workspace";
const encoder = new TextEncoder();

const projectionStub = {
  getThreadShellById: (id: ThreadId) =>
    Effect.succeed(
      id === threadId ? Option.some({ projectId, worktreePath: null }) : Option.none(),
    ),
  getProjectShellById: () => Effect.succeed(Option.some({ id: projectId, workspaceRoot })),
} as unknown as ProjectionSnapshotQueryShape;

const makeFakeSpawner = (spawned: Array<ChildProcess.StandardCommand>) =>
  ChildProcessSpawner.make((command) =>
    Effect.sync(() => {
      if (!ChildProcess.isStandardCommand(command)) {
        throw new Error("Expected standard command.");
      }
      spawned.push(command);
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(4242),
        exitCode: Effect.never,
        isRunning: Effect.succeed(true),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: Stream.succeed(encoder.encode("Waiting on http://localhost:4321\n")),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      });
    }),
  );

const buildManager = (input: {
  readonly spawned: Array<ChildProcess.StandardCommand>;
  readonly events: Stream.Stream<OrchestrationEvent>;
}) =>
  make.pipe(
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, makeFakeSpawner(input.spawned)),
    Effect.provideService(HostProcessPlatform, "linux"),
    Effect.provideService(NetService.NetService, {
      findAvailablePort: () => Effect.succeed(4321),
    } as unknown as NetService.NetService["Service"]),
    Effect.provideService(ProjectionSnapshotQuery, projectionStub),
    Effect.provideService(OrchestrationEngineService, {
      streamDomainEvents: input.events,
      latestSequence: Effect.succeed(0),
    } as unknown as OrchestrationEngineShape),
    Effect.provide(FileSystem.layerNoop({ exists: () => Effect.succeed(true) })),
  );

it.live("startServer spawns Metro in the thread workspace and reports running", () =>
  Effect.gen(function* () {
    const spawned: Array<ChildProcess.StandardCommand> = [];
    const manager = yield* buildManager({ spawned, events: Stream.empty });

    const snapshot = yield* manager.startServer({ threadId });

    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.command).toBe("npx");
    expect(spawned[0]?.args).toEqual(["expo", "start", "--dev-client", "--port", "4321", "--lan"]);
    expect(spawned[0]?.options.cwd).toBe(workspaceRoot);
    expect(snapshot.status).toBe("running");
    expect(snapshot.port).toBe(4321);
    expect(snapshot.cwd).toBe(workspaceRoot);

    const listed = yield* manager.list({});
    expect(listed.servers).toHaveLength(1);

    // Starting again while running is idempotent: no second Metro spawn.
    yield* manager.startServer({ threadId });
    expect(spawned).toHaveLength(1);

    yield* manager.stopServer({ threadId });
    const afterStop = yield* manager.list({});
    expect(afterStop.servers).toHaveLength(0);
  }).pipe(Effect.scoped),
);

it.live("settling a thread stops its preview server", () =>
  Effect.gen(function* () {
    const spawned: Array<ChildProcess.StandardCommand> = [];
    const eventsPubSub = yield* PubSub.unbounded<OrchestrationEvent>();
    const manager = yield* buildManager({
      spawned,
      events: Stream.fromPubSub(eventsPubSub),
    });

    yield* manager.start();
    yield* manager.startServer({ threadId });
    expect((yield* manager.list({})).servers).toHaveLength(1);

    // The reactor subscribes on a forked fiber; give the subscription time to
    // attach before publishing, since domain events are not replayed.
    yield* Effect.sleep("100 millis");
    yield* PubSub.publish(eventsPubSub, {
      type: "thread.settled",
      sequence: 1,
      payload: { threadId },
    } as unknown as OrchestrationEvent);

    // The settle hook runs on a forked fiber; poll until it lands.
    yield* manager.list({}).pipe(
      Effect.flatMap((result) =>
        result.servers.length === 0 ? Effect.void : Effect.fail("still running" as const),
      ),
      Effect.retry(Schedule.spaced("50 millis")),
      Effect.timeoutOption("5 seconds"),
    );
    expect((yield* manager.list({})).servers).toHaveLength(0);
  }).pipe(Effect.scoped),
);
