import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { defaultNS, resources } from "./locales/resources";
import {
  KEPLERLLM_DEFAULT_DETECTOR_NAME,
  createKeplerllmDefaultDetector,
} from "./utils/defaultUILanguage";

// Runtime default UI language (DEFAULT_UI_LANGUAGE) is exposed by the server
// per request via window.__KEPLERLLM_CONFIG__.defaultUILanguage, so container
// runtime values (including CapRover) work without a frontend rebuild.
// Detection order preserves explicit selection over the server default:
// querystring/cookie/localStorage/sessionStorage > keplerllmDefault (env) >
// browser (navigator/htmlTag) > fallback `en`. A manual UI choice is cached
// in localStorage by the detector and therefore wins on subsequent visits.
const languageDetector = new LanguageDetector();
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
        "localStorage",
        "sessionStorage",
        KEPLERLLM_DEFAULT_DETECTOR_NAME,
        "navigator",
        "htmlTag",
      ],
      caches: ["localStorage"],
    },
  });

export default i18next;
