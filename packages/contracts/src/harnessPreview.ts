/**
 * Harness preview — schemas for the harness Preview Server registry.
 *
 * A Preview Server is a Metro (`expo start --dev-client`) process the server
 * spawns for one thread's project so a harness build of the mobile app can
 * load that project's JS bundle. The server owns the process lifecycle:
 * started on demand, stopped explicitly, on thread settle, or by the idle
 * reaper.
 *
 * @module HarnessPreview
 */
import { Schema } from "effect";
import { ThreadId } from "./baseSchemas.ts";

export const HarnessPreviewServerStatus = Schema.Union([
  Schema.Literal("starting"),
  Schema.Literal("running"),
  Schema.Literal("failed"),
]);
export type HarnessPreviewServerStatus = typeof HarnessPreviewServerStatus.Type;

export const HarnessPreviewServerSnapshot = Schema.Struct({
  threadId: ThreadId,
  cwd: Schema.String,
  port: Schema.Int,
  /** Reachable from the LAN, when a private-network interface exists. */
  lanUrl: Schema.optionalKey(Schema.String),
  /** Reachable over Tailscale, when a tailnet interface exists. */
  tailnetUrl: Schema.optionalKey(Schema.String),
  status: HarnessPreviewServerStatus,
  startedAt: Schema.String,
  /** Last Metro bundle/HMR activity; the idle reaper keys off this. */
  lastActivityAt: Schema.String,
});
export type HarnessPreviewServerSnapshot = typeof HarnessPreviewServerSnapshot.Type;

export const HarnessPreviewStartInput = Schema.Struct({ threadId: ThreadId });
export type HarnessPreviewStartInput = typeof HarnessPreviewStartInput.Type;

export const HarnessPreviewStopInput = Schema.Struct({ threadId: ThreadId });
export type HarnessPreviewStopInput = typeof HarnessPreviewStopInput.Type;

export const HarnessPreviewListInput = Schema.Struct({});
export type HarnessPreviewListInput = typeof HarnessPreviewListInput.Type;

export const HarnessPreviewListResult = Schema.Struct({
  servers: Schema.Array(HarnessPreviewServerSnapshot),
});
export type HarnessPreviewListResult = typeof HarnessPreviewListResult.Type;

export class HarnessPreviewThreadNotFoundError extends Schema.TaggedErrorClass<HarnessPreviewThreadNotFoundError>()(
  "HarnessPreviewThreadNotFoundError",
  { threadId: Schema.String },
) {
  override get message(): string {
    return `No thread or project found for thread ${this.threadId}.`;
  }
}

export class HarnessPreviewCwdUnavailableError extends Schema.TaggedErrorClass<HarnessPreviewCwdUnavailableError>()(
  "HarnessPreviewCwdUnavailableError",
  { threadId: Schema.String, cwd: Schema.String },
) {
  override get message(): string {
    return `Project directory ${this.cwd} for thread ${this.threadId} does not exist on disk.`;
  }
}

export class HarnessPreviewSpawnError extends Schema.TaggedErrorClass<HarnessPreviewSpawnError>()(
  "HarnessPreviewSpawnError",
  { threadId: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `Failed to start preview server for thread ${this.threadId}: ${this.detail}`;
  }
}

export class HarnessPreviewNotRunningError extends Schema.TaggedErrorClass<HarnessPreviewNotRunningError>()(
  "HarnessPreviewNotRunningError",
  { threadId: Schema.String },
) {
  override get message(): string {
    return `No preview server is running for thread ${this.threadId}.`;
  }
}

export const HarnessPreviewError = Schema.Union([
  HarnessPreviewThreadNotFoundError,
  HarnessPreviewCwdUnavailableError,
  HarnessPreviewSpawnError,
  HarnessPreviewNotRunningError,
]);
export type HarnessPreviewError = typeof HarnessPreviewError.Type;
