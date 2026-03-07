/**
 * 프론트엔드 i18n 진입점.
 * 공유 JSON 로케일 + 공유 프로토콜(create_t)을 사용하는 React Context.
 */

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { create_t, parse_locale, SUPPORTED_LOCALES, type Locale, type TranslationDict, type TFunction } from "../../../src/i18n/protocol";
import { api } from "../api/client";
import en from "../../../src/i18n/locales/en.json";
import ko from "../../../src/i18n/locales/ko.json";

export type { Locale, TranslationDict, TFunction };
export { SUPPORTED_LOCALES };

const DICTS: Record<Locale, TranslationDict> = { en, ko };
const STORAGE_KEY = "soulflow_locale";

function get_initial_locale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return parse_locale(stored);
  } catch { /* SSR / private mode */ }
  return "en";
}

interface I18nContextValue {
  locale: Locale;
  set_locale: (l: Locale) => void;
  t: TFunction;
}

const I18nContext = createContext<I18nContextValue>(null!);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(get_initial_locale);

  const set_locale = (l: Locale) => {
    const validated = parse_locale(l);
    setLocale(validated);
    try { localStorage.setItem(STORAGE_KEY, validated); } catch { /* noop */ }
    document.documentElement.lang = validated;
    api.put("/api/locale", { locale: validated }).catch(() => {});
  };

  useEffect(() => {
    api.put("/api/locale", { locale }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const t = create_t(DICTS[locale], DICTS.en);

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
