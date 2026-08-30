import { requireOptionalNativeModule } from "expo";

type T3HarnessOverlayModule = {
  readonly show: (returnUrl: string, label: string) => Promise<void>;
  readonly hide: () => Promise<void>;
};

/** Null in builds without the native module (non-harness or pre-rebuild). */
const overlayModule = requireOptionalNativeModule<T3HarnessOverlayModule>("T3HarnessOverlay");

/** Show the native Back to Editor pill; call right before opening a preview. */
export const showBackToEditorOverlay = async (returnUrl: string): Promise<void> => {
  await overlayModule?.show(returnUrl, "Back to Editor");
};

/** Hide the overlay; the editor bundle calls this once it has mounted. */
export const hideBackToEditorOverlay = (): void => {
  void overlayModule?.hide();
};
