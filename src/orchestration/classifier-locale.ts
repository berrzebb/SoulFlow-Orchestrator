/** 분류기 로케일 타입 및 병합 유틸리티. 언어별 데이터는 locales/ 디렉토리에 위치. */

export type ClassifierLocale = {
  /** 봇 정체성 질문 구문. */
  identity_phrases: string[];
  /** 태스크 상태 조회 구문. */
  inquiry_phrases: string[];
  /** 단일 토큰 다단계 연결어. */
  connector_tokens: string[];
  /** 다단계 연결 구문 (두 단어 이상). */
  connector_phrases: string[];
  /** 명시적 비동기 실행 신호 구문. */
  task_signal_phrases: string[];
  /** 도구 조합 쌍 — 두 토큰이 모두 있으면 다단계 작업. */
  tool_pairs: [string, string][];
  /** 태스크 언급 정규식 소스 (구문 목록, | 조인하여 RE 생성). */
  task_mention_patterns: string[];
  /** 어시스턴트가 추가 정보를 요청할 때 나타나는 패턴 (정규식 소스). */
  assistant_info_request_patterns: string[];
  /** 사용자가 이전에 제공한 위치/조건을 참조하는 짧은 메시지 패턴 (정규식 소스). */
  user_context_reference_patterns: string[];
};

import { ko } from "./locales/ko.js";
import { en } from "./locales/en.js";

/** 두 개 이상의 로케일을 병합하여 단일 로케일 반환. */
export function merge(...locales: ClassifierLocale[]): ClassifierLocale {
  return {
    identity_phrases: locales.flatMap((l) => l.identity_phrases),
    inquiry_phrases: locales.flatMap((l) => l.inquiry_phrases),
    connector_tokens: locales.flatMap((l) => l.connector_tokens),
    connector_phrases: locales.flatMap((l) => l.connector_phrases),
    task_signal_phrases: locales.flatMap((l) => l.task_signal_phrases),
    tool_pairs: locales.flatMap((l) => l.tool_pairs),
    task_mention_patterns: locales.flatMap((l) => l.task_mention_patterns),
    assistant_info_request_patterns: locales.flatMap((l) => l.assistant_info_request_patterns),
    user_context_reference_patterns: locales.flatMap((l) => l.user_context_reference_patterns),
  };
}

/** 기본 로케일: 한국어 + 영어 병합. */
export const DEFAULT_CLASSIFIER_LOCALE: ClassifierLocale = merge(ko, en);
