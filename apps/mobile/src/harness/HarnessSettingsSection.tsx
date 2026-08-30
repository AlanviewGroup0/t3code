import Constants from "expo-constants";
import { Linking } from "react-native";

import { SettingsRow } from "../features/settings/components/SettingsRow";
import { SettingsSection } from "../features/settings/components/SettingsSection";

/**
 * Milestone-3 placeholder: a hand-configured preview target. The harness
 * backend's preview-server registry replaces this constant with live data.
 */
const DEMO_PREVIEW_URL = "http://100.98.96.2:8082";

function resolveScheme(): string | undefined {
  const scheme = Constants.expoConfig?.scheme;
  return Array.isArray(scheme) ? scheme[0] : scheme;
}

/**
 * Renders only in harness builds (T3CODE_HARNESS=1 at build time). Opening the
 * app's own dev-client deep link swaps the running bundle to the previewed
 * project; returning goes through the dev menu until Back to Editor exists.
 */
export function HarnessSettingsSection() {
  if (Constants.expoConfig?.extra?.harnessBuild !== true) {
    return null;
  }
  const scheme = resolveScheme();
  if (scheme === undefined) {
    return null;
  }
  const openDemo = () => {
    void Linking.openURL(
      `${scheme}://expo-development-client/?url=${encodeURIComponent(DEMO_PREVIEW_URL)}`,
    );
  };
  return (
    <SettingsSection title="Harness">
      <SettingsRow icon="shippingbox" label="Preview harness-demo" onPress={openDemo} />
    </SettingsSection>
  );
}
