import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

/**
 * Harness preview servers: the per-thread Metro processes the server manages
 * for harness builds of the mobile app. See contracts/harnessPreview.ts.
 */
export function createHarnessPreviewEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const lifecycleScheduler = createAtomCommandScheduler();
  const lifecycleConcurrency = {
    mode: "serial" as const,
    key: ({ environmentId, input }: { environmentId: string; input: { threadId: string } }) =>
      JSON.stringify([environmentId, input.threadId]),
  };
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:harness-preview:list",
      tag: WS_METHODS.harnessPreviewList,
      staleTimeMs: 5_000,
      // The registry is live state (servers start, idle out, get reaped), so
      // poll while a list is mounted.
      refreshIntervalMs: 10_000,
    }),
    start: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:harness-preview:start",
      tag: WS_METHODS.harnessPreviewStart,
      scheduler: lifecycleScheduler,
      concurrency: lifecycleConcurrency,
    }),
    stop: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:harness-preview:stop",
      tag: WS_METHODS.harnessPreviewStop,
      scheduler: lifecycleScheduler,
      concurrency: lifecycleConcurrency,
    }),
  };
}
