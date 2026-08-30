import Constants from "expo-constants";
import { Linking } from "react-native";

import { showBackToEditorOverlay } from "./overlay";

export const isHarnessBuild = (): boolean => Constants.expoConfig?.extra?.harnessBuild === true;

export const resolveScheme = (): string | undefined => {
  const scheme = Constants.expoConfig?.scheme;
  return Array.isArray(scheme) ? scheme[0] : scheme;
};

/** Deep link that makes the dev client load `targetUrl`'s JS bundle. */
export const buildDevClientDeepLink = (targetUrl: string): string | undefined => {
  const scheme = resolveScheme();
  if (scheme === undefined) {
    return undefined;
  }
  return `${scheme}://expo-development-client/?url=${encodeURIComponent(targetUrl)}`;
};

/**
 * Deep link that loads the T3 Code editor bundle back into the dev client:
 * the Metro server this very bundle came from (`hostUri`).
 */
export const resolveEditorReturnUrl = (): string | undefined => {
  const hostUri = Constants.expoConfig?.hostUri;
  if (!hostUri) {
    return undefined;
  }
  return buildDevClientDeepLink(`http://${hostUri}`);
};

/**
 * Swap the running bundle to a previewed project: arm the native Back to
 * Editor overlay (it survives the swap), then open the dev-client deep link.
 */
export const openProjectPreview = async (targetUrl: string): Promise<void> => {
  const deepLink = buildDevClientDeepLink(targetUrl);
  if (deepLink === undefined) {
    return;
  }
  const returnUrl = resolveEditorReturnUrl();
  if (returnUrl !== undefined) {
    await showBackToEditorOverlay(returnUrl);
  }
  await Linking.openURL(deepLink);
};
