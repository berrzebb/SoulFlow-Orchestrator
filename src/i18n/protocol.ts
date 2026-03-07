/**
 * 공유 i18n 프로토콜.
 * 프론트엔드(React)와 백엔드(Node.js) 모두 이 모듈의 타입과 함수를 사용.
 *
 * 소스 오브 트루스: src/i18n/locales/{locale}.json
 * 키 형식: 도트 구분 flat key ("tools.exec.desc", "node.git.label", "ui.common.save")
 */

export type Locale = "en" | "ko";

export const SUPPORTED_LOCALES: readonly Locale[] = ["en", "ko"] as const;
export const DEFAULT_LOCALE: Locale = "en";

/** JSON 파일에서 로드한 번역 사전. flat key → value. */
export type TranslationDict = Record<string, string>;

export type TFunction = (key: string, vars?: Record<string, string | number>) => string;

/**
 * 번역 조회 함수를 생성.
 * @param dict    현재 로케일 사전
 * @param fallback fallback 사전 (보통 en). dict에 키가 없으면 fallback에서 조회.
 * @returns t(key, vars?) — 키에 해당하는 번역 문자열. 없으면 키 자체를 반환.
 */
export function create_t(dict: TranslationDict, fallback?: TranslationDict): TFunction {
  return (key: string, vars?: Record<string, string | number>): string => {
    let text = dict[key] ?? fallback?.[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{${k}}`, String(v));
      }
    }
    return text;
  };
}

/** 로케일 문자열을 검증하여 Locale 타입으로 반환. 유효하지 않으면 default. */
export function parse_locale(value: unknown): Locale {
  if (typeof value === "string" && SUPPORTED_LOCALES.includes(value as Locale)) {
    return value as Locale;
  }
  return DEFAULT_LOCALE;
}

// ── i18n 키 네임스페이스 컨벤션 ──
//
// ui.*           — 대시보드 UI 문자열      (ui.common.save, ui.nav.overview)
// tool.*         — 에이전트 도구 설명       (tool.exec.desc, tool.exec.param.command)
// node.*         — 워크플로우 노드 메타     (node.git.label, node.git.output.stdout)
// workflows.*    — 워크플로우 빌더 UI       (workflows.llm_backend, workflows.add_node)
//
// 새 키를 추가할 때: 해당 네임스페이스 접두사를 사용.
// scripts/i18n-sync.ts 로 누락/고아 키를 자동 감지.
