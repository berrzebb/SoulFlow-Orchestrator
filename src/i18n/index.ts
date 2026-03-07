/**
 * 백엔드 i18n 진입점.
 * JSON 로케일 파일을 로드하고 create_t()를 통해 번역 함수를 제공.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { create_t, parse_locale, DEFAULT_LOCALE, type Locale, type TFunction, type TranslationDict } from "./protocol.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = resolve(__dirname, "locales");

const dict_cache = new Map<Locale, TranslationDict>();

function load_dict(locale: Locale): TranslationDict {
  let dict = dict_cache.get(locale);
  if (dict) return dict;
  try {
    const raw = readFileSync(resolve(LOCALES_DIR, `${locale}.json`), "utf-8");
    dict = JSON.parse(raw) as TranslationDict;
  } catch {
    dict = {};
  }
  dict_cache.set(locale, dict);
  return dict;
}

let current_locale: Locale = DEFAULT_LOCALE;

export function set_locale(locale: Locale): void {
  current_locale = parse_locale(locale);
}

export function get_locale(): Locale {
  return current_locale;
}

/** 지정 로케일(또는 현재 로케일)의 t 함수를 반환. */
export function get_t(locale?: Locale): TFunction {
  const loc = locale ? parse_locale(locale) : current_locale;
  const dict = load_dict(loc);
  const fallback = loc !== DEFAULT_LOCALE ? load_dict(DEFAULT_LOCALE) : undefined;
  return create_t(dict, fallback);
}

/** 현재 로케일로 번역. 간단한 호출용. */
export function t(key: string, vars?: Record<string, string | number>): string {
  return get_t()(key, vars);
}

export { create_t, parse_locale, DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./protocol.js";
export type { Locale, TFunction, TranslationDict } from "./protocol.js";
