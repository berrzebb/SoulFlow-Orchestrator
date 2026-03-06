import { createContext, useContext, useState, type ReactNode } from "react";
import { en } from "./en";
import { ko } from "./ko";

export type Locale = "en" | "ko";
export type TranslationDict = Record<string, string>;

const DICTS: Record<Locale, TranslationDict> = { en, ko };
const STORAGE_KEY = "soulflow_locale";

function get_initial_locale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "ko") return stored;
  } catch { /* SSR / private mode */ }
  return "en";
}

interface I18nContextValue {
  locale: Locale;
  set_locale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>(null!);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(get_initial_locale);

  const set_locale = (l: Locale) => {
    setLocale(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* noop */ }
    document.documentElement.lang = l;
  };

  const t = (key: string, vars?: Record<string, string | number>): string => {
    let text = DICTS[locale][key] ?? DICTS.en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{${k}}`, String(v));
      }
    }
    return text;
  };

  return (
    <I18nContext.Provider value={{ locale, set_locale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

export function useT() {
  return useContext(I18nContext).t;
}
