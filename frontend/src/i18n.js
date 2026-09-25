import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { defaultNS, resources } from "./locales/resources";
import {
  KEPLERLLM_DEFAULT_DETECTOR_NAME,
  KEPLERLLM_EXPLICIT_DETECTOR_NAME,
  createKeplerllmDefaultDetector,
  createKeplerllmExplicitDetector,
} from "./utils/defaultUILanguage";

// Runtime default UI language (DEFAULT_UI_LANGUAGE) is exposed by the server
// per request via window.__KEPLERLLM_CONFIG__.defaultUILanguage, so container
// runtime values (including CapRover) work without a frontend rebuild.
// Detection order implements: explicit KeplerLLM preference >
// DEFAULT_UI_LANGUAGE > browser (navigator/htmlTag) > fallback `en`.
// The generic `localStorage`/`sessionStorage` (`i18nextLng`) detectors are
// intentionally not consulted: i18next caches the auto-detected/default
// language there on init, so `i18nextLng` cannot prove an explicit user
// choice and must not block a newly configured DEFAULT_UI_LANGUAGE. Only a
// manual UI selection writes the explicit KeplerLLM preference, which then
// wins on subsequent visits. `caches` still targets `localStorage` so the
// existing `i18nextLng` cache keeps being written, not deleted.
const languageDetector = new LanguageDetector();
languageDetector.addDetector(
  createKeplerllmExplicitDetector(Object.keys(resources))
);
languageDetector.addDetector(
  createKeplerllmDefaultDetector(Object.keys(resources))
);

i18next
  // https://github.com/i18next/i18next-browser-languageDetector/blob/9efebe6ca0271c3797bc09b84babf1ba2d9b4dbb/src/index.js#L11
  .use(initReactI18next) // Initialize i18n for React
  .use(languageDetector)
  .init({
    fallbackLng: "en",
    debug: import.meta.env.DEV,
    defaultNS,
    resources,
    lowerCaseLng: true,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: [
        "querystring",
        "cookie",
        KEPLERLLM_EXPLICIT_DETECTOR_NAME,
        KEPLERLLM_DEFAULT_DETECTOR_NAME,
        "navigator",
        "htmlTag",
      ],
      caches: ["localStorage"],
    },
  });

export default i18next;
