// Top languages spoken across the United States (US Census + ACS).
// `rtl` marks right-to-left scripts. `native` is the endonym shown in the picker.
export type LangMeta = { code: string; label: string; native: string; rtl?: boolean };

export const LANGUAGES: LangMeta[] = [
  { code: "en", label: "English", native: "English" },
  { code: "es", label: "Spanish", native: "Español" },
  { code: "zh", label: "Chinese (Simplified)", native: "中文" },
  { code: "tl", label: "Tagalog", native: "Tagalog" },
  { code: "vi", label: "Vietnamese", native: "Tiếng Việt" },
  { code: "ar", label: "Arabic", native: "العربية", rtl: true },
  { code: "fr", label: "French", native: "Français" },
  { code: "ko", label: "Korean", native: "한국어" },
  { code: "ru", label: "Russian", native: "Русский" },
  { code: "ht", label: "Haitian Creole", native: "Kreyòl Ayisyen" },
  { code: "de", label: "German", native: "Deutsch" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "pt", label: "Portuguese", native: "Português" },
  { code: "it", label: "Italian", native: "Italiano" },
  { code: "pl", label: "Polish", native: "Polski" },
  { code: "ja", label: "Japanese", native: "日本語" },
  { code: "ur", label: "Urdu", native: "اردو", rtl: true },
  { code: "fa", label: "Persian", native: "فارسی", rtl: true },
  { code: "gu", label: "Gujarati", native: "ગુજરાતી" },
  { code: "bn", label: "Bengali", native: "বাংলা" },
];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);
export const RTL_CODES = LANGUAGES.filter((l) => l.rtl).map((l) => l.code);

export function metaFor(code: string): LangMeta {
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
}
