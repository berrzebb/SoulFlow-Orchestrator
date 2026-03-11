/** 분류기 로케일 데이터 — 언어별 키워드/구문을 분류 로직에서 분리. */

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
};

const ko: ClassifierLocale = {
  identity_phrases: [
    "너 누구야", "너 누구니", "너 누구세요",
    "당신 누구세요", "당신은 누구세요",
    "넌 누구야", "넌 뭐야", "너 뭐야",
    "자기소개 해줘", "자기 소개 해줘", "자기소개해줘",
    "누구", "넌 누구", "너 누구",
  ],
  inquiry_phrases: [
    "작업 어떻게 됐어", "작업 됐어", "작업 끝났어", "작업 완료됐어",
    "태스크 상태 어때", "태스크 진행 어떻게", "백그라운드 작업 어때",
    "진행 중인 작업", "작업 진행상황",
    "다 됐어", "결과 나왔어", "완료됐어", "끝났어",
    "작업 취소", "작업 중단", "취소해줘", "그만해",
  ],
  connector_tokens: ["하고서", "그다음", "후에"],
  connector_phrases: ["하고 나서", "그 다음에", "그리고 나서", "한 다음", "그 후"],
  task_signal_phrases: ["백그라운드", "비동기", "나중에 알려"],
  tool_pairs: [
    ["파일", "보내"], ["읽", "요약"], ["검색", "정리"],
    ["분석", "보고"], ["가져", "저장"],
  ],
  task_mention_patterns: [
    "태스크", "작업.{0,6}시작", "백그라운드.{0,4}작업",
  ],
};

const en: ClassifierLocale = {
  identity_phrases: [
    "who are you", "what are you", "introduce yourself",
  ],
  inquiry_phrases: [
    "what's the status", "how's the task", "task done", "task finished",
    "is it done", "task progress", "background task status",
    "cancel task", "stop task", "cancel it", "stop it",
  ],
  connector_tokens: ["then"],
  connector_phrases: ["and then", "after that"],
  task_signal_phrases: ["background", "async", "schedule", "notify when done", "run in background"],
  tool_pairs: [
    ["file", "send"], ["read", "summar"], ["search", "send"], ["fetch", "save"],
  ],
  task_mention_patterns: [
    "task.{0,10}id", "started.{0,10}task", "background.task",
  ],
};

/** 두 로케일을 병합하여 단일 로케일 반환. */
function merge(...locales: ClassifierLocale[]): ClassifierLocale {
  return {
    identity_phrases: locales.flatMap((l) => l.identity_phrases),
    inquiry_phrases: locales.flatMap((l) => l.inquiry_phrases),
    connector_tokens: locales.flatMap((l) => l.connector_tokens),
    connector_phrases: locales.flatMap((l) => l.connector_phrases),
    task_signal_phrases: locales.flatMap((l) => l.task_signal_phrases),
    tool_pairs: locales.flatMap((l) => l.tool_pairs),
    task_mention_patterns: locales.flatMap((l) => l.task_mention_patterns),
  };
}

/** 기본 로케일: 한국어 + 영어 병합. */
export const DEFAULT_CLASSIFIER_LOCALE: ClassifierLocale = merge(ko, en);
