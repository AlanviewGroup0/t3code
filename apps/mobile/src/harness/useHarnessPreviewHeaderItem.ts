import { useCallback, useMemo } from "react";
import { Alert } from "react-native";

import { harnessPreviewEnvironment } from "../state/harnessPreview";
import { useAtomCommand } from "../state/use-atom-command";
import { useThreadSelection } from "../state/use-thread-selection";
import { isHarnessBuild, openProjectPreview } from "./previewDeepLink";

type HeaderItem = Record<string, unknown>;

/**
 * "Preview app" header action for the active thread: asks the server for the
 * thread's preview server (starting one if needed), then swaps the running
 * bundle to it. Null outside harness builds so stock header layouts are
 * untouched.
 */
export function useHarnessPreviewHeaderItem(): HeaderItem | null {
  const { selectedThread } = useThreadSelection();
  const startPreview = useAtomCommand(harnessPreviewEnvironment.start, "harness preview start");

  const environmentId = selectedThread?.environmentId ?? null;
  const threadId = selectedThread?.id ?? null;

  const onPress = useCallback(async () => {
    if (environmentId === null || threadId === null) {
      return;
    }
    const result = await startPreview({ environmentId, input: { threadId } });
    if (result._tag === "Failure") {
      Alert.alert(
        "Couldn't start preview",
        "The preview server did not start. Check the thread's project directory on the desktop.",
      );
      return;
    }
    const url = result.value.tailnetUrl ?? result.value.lanUrl;
    if (url === undefined) {
      Alert.alert("Couldn't open preview", "The preview server has no reachable address.");
      return;
    }
    await openProjectPreview(url);
  }, [environmentId, startPreview, threadId]);

  return useMemo(() => {
    if (!isHarnessBuild() || threadId === null) {
      return null;
    }
    return {
      accessibilityLabel: "Preview app",
      icon: { name: "iphone", type: "sfSymbol" },
      identifier: "thread-right-harness-preview",
      label: "Preview",
      onPress: () => {
        void onPress();
      },
      sharesBackground: true,
      type: "button",
      variant: "plain",
    };
  }, [onPress, threadId]);
}
