// Runtime default UI language helpers.
//
// Precedence (highest first):
//   1. Explicit language previously selected by the user (localStorage `i18nextLng`)
//   2. DEFAULT_UI_LANGUAGE from the server runtime config
//      (`window.__KEPLERLLM_CONFIG__.defaultUILanguage`)
//   3. Browser-detected language
//   4. `en` (i18next `fallbackLng`)
//
// DEFAULT_UI_LANGUAGE is a default, not a forced language. A manual choice
// made through the UI is cached by i18next-browser-languagedetector in
// localStorage and wins over the server default on subsequent visits because
// the `localStorage` detector runs before the `keplerllmDefault` detector.
//
// Validation always happens against the locale keys actually exported by
// `frontend/src/locales/resources.js`. No duplicated hardcoded language list
// is maintained here. `pt` selects the existing Brazilian Portuguese
// translation (`frontend/src/locales/pt_BR/common.js` registered as `pt`).

export const KEPLERLLM_DEFAULT_DETECTOR_NAME = "keplerllmDefault";
export const STORED_LANGUAGE_KEY = "i18nextLng";
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

// Read an explicit user selection previously stored by
// i18next-browser-languagedetector. Returns the supported key or null.
export function readStoredLanguage(supportedLanguages = [], storage = null) {
  try {
    const store =
      storage ??
      (typeof globalThis !== "undefined" && globalThis.localStorage
        ? globalThis.localStorage
        : typeof window !== "undefined" && window.localStorage
          ? window.localStorage
          : null);
    const raw = store?.getItem?.(STORED_LANGUAGE_KEY);
    return resolveSupportedLanguage(raw, supportedLanguages);
  } catch {
    return null;
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
// - storedLanguage: explicit user selection (wins)
// - runtimeDefault: DEFAULT_UI_LANGUAGE (default only)
// - detectedLanguage: browser-detected language
// - fallbackLng: final fallback (`en`)
export function resolveInitialLanguage({
  storedLanguage = null,
  runtimeDefault = null,
  detectedLanguage = null,
  fallbackLng = FALLBACK_LANGUAGE,
  supportedLanguages = [],
} = {}) {
  const stored = resolveSupportedLanguage(storedLanguage, supportedLanguages);
  if (stored) return stored;
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

// Custom i18next-browser-languagedetector entry. Positioned after the stored
// detectors (`localStorage`, `sessionStorage`) and before `navigator` so the
// order is: explicit selection > DEFAULT_UI_LANGUAGE > browser > fallback.
export function createKeplerllmDefaultDetector(supportedLanguages = []) {
  return {
    name: KEPLERLLM_DEFAULT_DETECTOR_NAME,
    lookup() {
      return readRuntimeDefaultLanguage(supportedLanguages) ?? undefined;
    },
  };
}
