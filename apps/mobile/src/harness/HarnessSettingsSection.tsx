import type { EnvironmentId, HarnessPreviewServerSnapshot, ThreadId } from "@t3tools/contracts";
import { Alert } from "react-native";

import { SettingsRow } from "../features/settings/components/SettingsRow";
import { SettingsSection } from "../features/settings/components/SettingsSection";
import { useEnvironments } from "../state/environments";
import { harnessPreviewEnvironment } from "../state/harnessPreview";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { isHarnessBuild, openProjectPreview } from "./previewDeepLink";

/**
 * Milestone-3 placeholder target: a hand-started dev server. Rows above it
 * come from the server's live preview registry.
 */
const DEMO_PREVIEW_URL = "http://100.98.96.2:8082";

const projectLabel = (server: HarnessPreviewServerSnapshot): string =>
  server.cwd.split("/").filter(Boolean).at(-1) ?? server.cwd;

function EnvironmentServerRows(props: { readonly environmentId: EnvironmentId }) {
  const query = useEnvironmentQuery(
    harnessPreviewEnvironment.list({ environmentId: props.environmentId, input: {} }),
  );
  const stopServer = useAtomCommand(harnessPreviewEnvironment.stop, "harness preview stop");

  const servers = query.data?.servers ?? [];
  if (servers.length === 0) {
    return null;
  }
  const onPressServer = (server: HarnessPreviewServerSnapshot) => {
    const url = server.tailnetUrl ?? server.lanUrl;
    Alert.alert(projectLabel(server), `${server.status} · port ${server.port}`, [
      ...(url !== undefined
        ? [
            {
              text: "Open preview",
              onPress: () => {
                void openProjectPreview(url);
              },
            },
          ]
        : []),
      {
        text: "Stop server",
        style: "destructive" as const,
        onPress: () => {
          void (async () => {
            await stopServer({
              environmentId: props.environmentId,
              input: { threadId: server.threadId as ThreadId },
            });
            query.refresh();
          })();
        },
      },
      { text: "Cancel", style: "cancel" as const },
    ]);
  };

  return (
    <>
      {servers.map((server) => (
        <SettingsRow
          key={server.threadId}
          icon="play.circle"
          label={projectLabel(server)}
          value={`${server.status} · :${server.port}`}
          onPress={() => {
            onPressServer(server);
          }}
        />
      ))}
    </>
  );
}

function HarnessServersList() {
  const { environments } = useEnvironments();
  return (
    <>
      {environments.map((environment) => (
        <EnvironmentServerRows
          key={environment.environmentId}
          environmentId={environment.environmentId}
        />
      ))}
    </>
  );
}

/** Renders only in harness builds (T3CODE_HARNESS=1 at build time). */
export function HarnessSettingsSection() {
  if (!isHarnessBuild()) {
    return null;
  }
  return (
    <SettingsSection title="Harness">
      <HarnessServersList />
      <SettingsRow
        icon="shippingbox"
        label="Preview harness-demo"
        onPress={() => {
          void openProjectPreview(DEMO_PREVIEW_URL);
        }}
      />
    </SettingsSection>
  );
}
