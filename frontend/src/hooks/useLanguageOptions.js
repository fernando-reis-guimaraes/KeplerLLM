import i18n from "@/i18n";
import { resources as languages } from "@/locales/resources";
import { writeExplicitLanguage } from "@/utils/defaultUILanguage";

export function useLanguageOptions() {
  const supportedLanguages = Object.keys(languages);
  const languageNames = new Intl.DisplayNames(supportedLanguages, {
    type: "language",
  });
  const changeLanguage = (newLang = "en") => {
    if (!Object.keys(languages).includes(newLang)) return false;
    // Persist the manual selection as the explicit KeplerLLM preference so it
    // keeps overriding DEFAULT_UI_LANGUAGE on subsequent visits. Automatic
    // detection/defaults never write this key.
    writeExplicitLanguage(newLang, supportedLanguages);
    i18n.changeLanguage(newLang);
  };

  return {
    currentLanguage: i18n.language || "en",
    supportedLanguages,
    getLanguageName: (lang = "en") => languageNames.of(lang),
    changeLanguage,
  };
}
