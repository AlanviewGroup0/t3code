/**
 * Derives the Expo config fragments the harness layer contributes to
 * app.config.ts from the capability manifest. Kept separate from the manifest
 * so the manifest stays pure data.
 */

import type { ExpoConfig } from "expo/config";

import { HARNESS_CAPABILITIES } from "./manifest.ts";

/** Config plugin entries for every capability that needs one. */
export const harnessPlugins: NonNullable<ExpoConfig["plugins"]> = HARNESS_CAPABILITIES.flatMap(
  (capability) => (capability.plugin === undefined ? [] : [capability.plugin]),
);

/**
 * Info.plist additions: per-capability extras plus the union of requested
 * UIBackgroundModes. Spread into ios.infoPlist AFTER upstream's entries; the
 * harness must not define keys upstream also defines.
 */
export const harnessInfoPlist: Record<string, unknown> = {
  ...Object.assign({}, ...HARNESS_CAPABILITIES.map((capability) => capability.infoPlist ?? {})),
  UIBackgroundModes: [
    ...new Set(HARNESS_CAPABILITIES.flatMap((capability) => capability.backgroundModes ?? [])),
  ],
};
