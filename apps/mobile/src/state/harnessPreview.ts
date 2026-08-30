import { createHarnessPreviewEnvironmentAtoms } from "@t3tools/client-runtime/state/harnessPreview";

import { connectionAtomRuntime } from "../connection/runtime";

export const harnessPreviewEnvironment =
  createHarnessPreviewEnvironmentAtoms(connectionAtomRuntime);
