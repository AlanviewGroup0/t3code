/**
 * Harness capability manifest — the single source of truth for which native
 * capabilities are baked into the harness build beyond stock T3 Code mobile.
 *
 * Everything the harness adds to the upstream app config derives from this
 * file (see ./config.ts), and the desktop side can import it to answer "what
 * can the installed harness do?" without parsing the Xcode project.
 *
 * Adding a capability = add an entry here, rebuild the app. Removing likewise.
 */

type PluginEntry = string | [string, Record<string, unknown>];

export type HarnessCapability = {
  /** Stable id used by tooling and (later) the harness backend. */
  readonly id: string;
  /** npm package providing the native module. */
  readonly module: string;
  /** Expo config plugin entry, when the module needs one for permissions. */
  readonly plugin?: PluginEntry;
  /** Extra Info.plist entries not covered by the plugin. */
  readonly infoPlist?: Record<string, unknown>;
  /** UIBackgroundModes values this capability needs. */
  readonly backgroundModes?: ReadonlyArray<string>;
};

const usage = (what: string): string =>
  `This development harness uses ${what} on behalf of the app being previewed.`;

export const HARNESS_CAPABILITIES: ReadonlyArray<HarnessCapability> = [
  {
    id: "location",
    module: "expo-location",
    plugin: [
      "expo-location",
      {
        locationWhenInUsePermission: usage("your location"),
        locationAlwaysAndWhenInUsePermission: usage("your location in the background"),
      },
    ],
    backgroundModes: ["location"],
  },
  {
    id: "media-library",
    module: "expo-media-library",
    plugin: [
      "expo-media-library",
      {
        photosPermission: usage("your photo library"),
        savePhotosPermission: usage("saving to your photo library"),
      },
    ],
  },
  { id: "document-picker", module: "expo-document-picker" },
  {
    id: "audio",
    module: "expo-audio",
    plugin: ["expo-audio", { microphonePermission: usage("the microphone") }],
    backgroundModes: ["audio"],
  },
  { id: "video", module: "expo-video" },
  {
    id: "sensors",
    module: "expo-sensors",
    plugin: ["expo-sensors", { motionPermission: usage("motion and fitness sensors") }],
  },
  {
    id: "contacts",
    module: "expo-contacts",
    plugin: ["expo-contacts", { contactsPermission: usage("your contacts") }],
  },
  {
    id: "calendar",
    module: "expo-calendar",
    plugin: [
      "expo-calendar",
      {
        calendarPermission: usage("your calendar"),
        remindersPermission: usage("your reminders"),
      },
    ],
  },
  {
    id: "local-authentication",
    module: "expo-local-authentication",
    plugin: ["expo-local-authentication", { faceIDPermission: usage("Face ID") }],
  },
  { id: "task-manager", module: "expo-task-manager" },
  {
    id: "background-task",
    module: "expo-background-task",
    backgroundModes: ["processing", "fetch"],
  },
  { id: "brightness", module: "expo-brightness" },
  { id: "speech", module: "expo-speech" },
  { id: "battery", module: "expo-battery" },
  {
    id: "tracking-transparency",
    module: "expo-tracking-transparency",
    plugin: [
      "expo-tracking-transparency",
      { userTrackingPermission: usage("tracking permission prompts") },
    ],
  },
  { id: "screen-orientation", module: "expo-screen-orientation" },
  // ---- Exotic (non-first-party) capabilities added via the harness-add flow ----
  {
    id: "stripe",
    module: "@stripe/stripe-react-native",
    plugin: ["@stripe/stripe-react-native", { enableGooglePay: false }],
  },
  {
    id: "google-signin",
    module: "@react-native-google-signin/google-signin",
    // App-specific: the URL scheme belongs to the previewed app's OAuth client.
    plugin: [
      "@react-native-google-signin/google-signin",
      { iosUrlScheme: "com.googleusercontent.apps.618461935267-rfurcgk08ti4nrki5j6inm5e52d80hkp" },
    ],
  },
  { id: "skia", module: "@shopify/react-native-skia" },
  { id: "async-storage", module: "@react-native-async-storage/async-storage" },
  { id: "linear-gradient", module: "expo-linear-gradient" },
  { id: "apple-authentication", module: "expo-apple-authentication" },
  { id: "status-bar", module: "expo-status-bar" },
] as const;
