// Runtime default UI language helpers.
//
// Effective precedence (highest first):
//   1. Explicit KeplerLLM user language preference
//      (localStorage `keplerllmExplicitUILanguage`, written only when the user
//      changes the language through the KeplerLLM UI)
//   2. DEFAULT_UI_LANGUAGE from the server runtime config
//      (`window.__KEPLERLLM_CONFIG__.defaultUILanguage`)
//   3. Browser-detected language
//   4. `en` (i18next `fallbackLng`)
//
// `i18nextLng` is intentionally NOT treated as proof of an explicit user
// selection: i18next caches the language selected during initialization
// (browser detection or the runtime default) into `i18nextLng` via
// `languageDetector.cacheUserLanguage(...)`, so a stored `i18nextLng` value
// cannot distinguish an explicit choice from automatic detection. Existing
// users who only have an automatically cached `i18nextLng` and never manually
// selected a language therefore still receive a newly configured
// DEFAULT_UI_LANGUAGE. The absence of the explicit-preference key means "no
// explicit user preference"; `i18nextLng` is never migrated into it.
//
// Validation always happens against the locale keys actually exported by
// `frontend/src/locales/resources.js`. No duplicated hardcoded language list
// is maintained here. `pt` selects the existing Brazilian Portuguese
// translation (`frontend/src/locales/pt_BR/common.js` registered as `pt`).

export const KEPLERLLM_EXPLICIT_DETECTOR_NAME = "keplerllmExplicit";
export const KEPLERLLM_DEFAULT_DETECTOR_NAME = "keplerllmDefault";
export const EXPLICIT_LANGUAGE_KEY = "keplerllmExplicitUILanguage";
export const FALLBACK_LANGUAGE = "en";

// Trim, lowercase, and normalize `_` to `-` so `pt`, `PT`, `pt-BR`, and
// `pt_BR` are handled without breaking the existing `pt` locale key.
// Returns the normalized tag or null when the input is empty or malformed.
export function normalizeLanguageTag(raw) {
  if (raw == null) return null;
  const normalized = String(raw).trim().toLowerCase().replace(/_/g, "-");
  if (!normalized) return null;
  if (normalized.length > 32) return null;
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(normalized)) return null;
  return normalized;
}

// Match a normalized tag against the supported locale keys. Tries a direct
// match first (`zh-tw`), then falls back to the base language (`pt-br` -> `pt`,
// `en-us` -> `en`). Returns the exact supported key or null.
export function matchSupportedLanguage(normalizedTag, supportedLanguages = []) {
  if (!normalizedTag) return null;
  const supported = Array.isArray(supportedLanguages) ? supportedLanguages : [];
  const byLowerCase = new Map(
    supported.map((key) => [String(key).toLowerCase(), key])
  );
  const direct = byLowerCase.get(normalizedTag);
  if (direct) return direct;
  const base = normalizedTag.split("-")[0];
  if (base && base !== normalizedTag) {
    const baseMatch = byLowerCase.get(base);
    if (baseMatch) return baseMatch;
  }
  return null;
}

// Validate a raw value against the supported locale keys. Returns the exact
// supported key or null when unset or unsupported.
export function resolveSupportedLanguage(raw, supportedLanguages = []) {
  return matchSupportedLanguage(normalizeLanguageTag(raw), supportedLanguages);
}

// Resolve the default browser storage, or null when unavailable.
function defaultStorage() {
  try {
    if (typeof globalThis !== "undefined" && globalThis.localStorage)
      return globalThis.localStorage;
    if (typeof window !== "undefined" && window.localStorage)
      return window.localStorage;
  } catch {
    // Storage access can throw (e.g. blocked cookies); treat as unavailable.
  }
  return null;
}

// Read the explicit KeplerLLM user language preference. Returns the supported
// key or null when absent or invalid. An invalid persisted value is ignored
// safely so resolution can continue with the runtime default.
export function readExplicitLanguage(supportedLanguages = [], storage = null) {
  try {
    const store = storage ?? defaultStorage();
    const raw = store?.getItem?.(EXPLICIT_LANGUAGE_KEY);
    return resolveSupportedLanguage(raw, supportedLanguages);
  } catch {
    return null;
  }
}

// Persist a manually selected language as the explicit KeplerLLM preference.
// Call only when the user actually changes the language through the UI.
// Returns true when a validated language was stored, false otherwise.
export function writeExplicitLanguage(
  raw,
  supportedLanguages = [],
  storage = null
) {
  try {
    const validated = resolveSupportedLanguage(raw, supportedLanguages);
    if (!validated) return false;
    const store = storage ?? defaultStorage();
    store?.setItem?.(EXPLICIT_LANGUAGE_KEY, validated);
    return true;
  } catch {
    return false;
  }
}

// Read the server-provided runtime default. `runtimeConfig` defaults to
// `window.__KEPLERLLM_CONFIG__` and is injectable for tests. Returns the
// supported key or null when unset or unsupported.
export function readRuntimeDefaultLanguage(
  supportedLanguages = [],
  runtimeConfig = null
) {
  try {
    const config =
      runtimeConfig ??
      (typeof globalThis !== "undefined"
        ? (globalThis.__KEPLERLLM_CONFIG__ ??
          globalThis.window?.__KEPLERLLM_CONFIG__ ??
          null)
        : null);
    return resolveSupportedLanguage(
      config?.defaultUILanguage,
      supportedLanguages
    );
  } catch {
    return null;
  }
}

// Pure precedence resolver used by tests and documentation. All inputs are raw
// values; each is validated against `supportedLanguages`.
// - explicitLanguage: explicit KeplerLLM user preference (wins)
// - runtimeDefault: DEFAULT_UI_LANGUAGE (default only)
// - detectedLanguage: browser-detected language
// - fallbackLng: final fallback (`en`)
export function resolveInitialLanguage({
  explicitLanguage = null,
  runtimeDefault = null,
  detectedLanguage = null,
  fallbackLng = FALLBACK_LANGUAGE,
  supportedLanguages = [],
} = {}) {
  const explicit = resolveSupportedLanguage(
    explicitLanguage,
    supportedLanguages
  );
  if (explicit) return explicit;
  const runtime = resolveSupportedLanguage(runtimeDefault, supportedLanguages);
  if (runtime) return runtime;
  const detected = resolveSupportedLanguage(
    detectedLanguage,
    supportedLanguages
  );
  if (detected) return detected;
  const fallback = resolveSupportedLanguage(fallbackLng, supportedLanguages);
  return fallback ?? FALLBACK_LANGUAGE;
}

// Storage-level resolver mirroring the runtime detector chain. Reads the
// explicit preference and the runtime default from the provided state and
// validates the browser language, implementing:
// explicit preference > DEFAULT_UI_LANGUAGE > browser > `en`.
// The generic `i18nextLng` cache is deliberately ignored: it may hold an
// automatically detected/default language rather than an explicit choice.
export function resolveEffectiveLanguage({
  storage = null,
  runtimeConfig = null,
  browserLanguage = null,
  fallbackLng = FALLBACK_LANGUAGE,
  supportedLanguages = [],
} = {}) {
  const explicit = readExplicitLanguage(supportedLanguages, storage);
  if (explicit) return explicit;
  const runtime = readRuntimeDefaultLanguage(supportedLanguages, runtimeConfig);
  if (runtime) return runtime;
  const detected = resolveSupportedLanguage(
    browserLanguage,
    supportedLanguages
  );
  if (detected) return detected;
  const fallback = resolveSupportedLanguage(fallbackLng, supportedLanguages);
  return fallback ?? FALLBACK_LANGUAGE;
}

// Custom i18next-browser-languagedetector entry for the explicit KeplerLLM
// preference. Evaluated independently from the generic `localStorage`
// (`i18nextLng`) detector, which must not take precedence over the runtime
// default.
export function createKeplerllmExplicitDetector(supportedLanguages = []) {
  return {
    name: KEPLERLLM_EXPLICIT_DETECTOR_NAME,
    lookup() {
      return readExplicitLanguage(supportedLanguages) ?? undefined;
    },
  };
}

// Custom i18next-browser-languagedetector entry for DEFAULT_UI_LANGUAGE.
// Positioned after the explicit preference and before the browser detectors
// so the order is: explicit preference > DEFAULT_UI_LANGUAGE > browser.
export function createKeplerllmDefaultDetector(supportedLanguages = []) {
  return {
    name: KEPLERLLM_DEFAULT_DETECTOR_NAME,
    lookup() {
      return readRuntimeDefaultLanguage(supportedLanguages) ?? undefined;
    },
  };
}
