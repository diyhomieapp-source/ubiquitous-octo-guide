import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import * as Localization from "expo-localization";
import "intl-pluralrules";

import { LANGUAGE_CODES } from "./languages";
import { storage } from "@/src/utils/storage";

import en from "./locales/en.json";
import es from "./locales/es.json";
import zh from "./locales/zh.json";
import tl from "./locales/tl.json";
import vi from "./locales/vi.json";
import ar from "./locales/ar.json";
import fr from "./locales/fr.json";
import ko from "./locales/ko.json";
import ru from "./locales/ru.json";
import ht from "./locales/ht.json";
import de from "./locales/de.json";
import hi from "./locales/hi.json";
import pt from "./locales/pt.json";
import it from "./locales/it.json";
import pl from "./locales/pl.json";
import ja from "./locales/ja.json";
import ur from "./locales/ur.json";
import fa from "./locales/fa.json";
import gu from "./locales/gu.json";
import bn from "./locales/bn.json";

export const LANG_KEY = "diyhomie_lang";

const resources = {
  en: { translation: en }, es: { translation: es }, zh: { translation: zh },
  tl: { translation: tl }, vi: { translation: vi }, ar: { translation: ar },
  fr: { translation: fr }, ko: { translation: ko }, ru: { translation: ru },
  ht: { translation: ht }, de: { translation: de }, hi: { translation: hi },
  pt: { translation: pt }, it: { translation: it }, pl: { translation: pl },
  ja: { translation: ja }, ur: { translation: ur }, fa: { translation: fa },
  gu: { translation: gu }, bn: { translation: bn },
} as const;

// The device's preferred language, normalized to a supported code (or "en").
export function deviceLanguage(): string {
  try {
    const code = Localization.getLocales()?.[0]?.languageCode?.toLowerCase();
    return code && LANGUAGE_CODES.includes(code) ? code : "en";
  } catch {
    return "en";
  }
}

// Init synchronously so the first paint already has a sensible language
// (device locale). A stored user choice is applied right after, if present.
i18n.use(initReactI18next).init({
  resources,
  lng: deviceLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

// Apply a previously saved override (user explicitly picked a language).
storage.getItem<string>(LANG_KEY, "").then((saved) => {
  if (saved && LANGUAGE_CODES.includes(saved) && saved !== i18n.language) {
    i18n.changeLanguage(saved);
  }
});

export async function setLanguage(code: string): Promise<void> {
  await i18n.changeLanguage(code);
  await storage.setItem(LANG_KEY, code);
}

export async function resetToDeviceLanguage(): Promise<string> {
  await storage.removeItem(LANG_KEY);
  const code = deviceLanguage();
  await i18n.changeLanguage(code);
  return code;
}

export default i18n;
