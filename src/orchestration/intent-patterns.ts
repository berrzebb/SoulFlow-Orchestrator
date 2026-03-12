/** Intent 정규식 + 파일/코드 패턴 추출 유틸. LLM 호출 없이 규칙 기반. */

export const INTENT_PATTERNS: Record<string, RegExp[]> = {
  generate_document: [/만들어|생성|작성|create|generate|make/i, /파일|문서|보고서|report|file|document/i],
  analyze_data: [/분석|통계|요약|데이터|analyze|analysis|data|statistics/i],
  // 단일 패턴으로 변경: 음식/장소/날씨/검색 등 광범위한 web 의도 포괄
  search_web: [/검색|찾아|찾을|추천|맛집|식당|카페|레스토랑|점심|저녁|아침|브런치|먹을|음식|날씨|뉴스|정보|어때|장소|주변|근처|search|find|look.?up|weather|news|recommend|restaurant|food|nearby|cafe|lunch|dinner/i],
  execute_code: [/실행|코드|스크립트|run|execute|script/i],
  version_control: [/커밋|PR|이슈|브랜치|commit|branch|push|pull request/i],
  send_message: [/전송|보내|알림|메시지|send|notify|message/i],
  read_file: [/읽어|열어|확인|open|read|show|view/i, /파일|file/i],
  write_file: [/저장|쓰기|편집|수정|save|write|edit/i, /파일|file/i],
  query_database: [/쿼리|조회|데이터베이스|query|select|database/i],
};

/**
 * Intent 레이블 → 도구 카테고리 매핑.
 * fast_classify의 히스토리 기반 도구 힌트 추출에서 사용.
 */
export const INTENT_TO_TOOL_CATEGORIES: Record<string, string[]> = {
  search_web:        ["web"],
  generate_document: ["filesystem"],
  analyze_data:      ["filesystem", "data"],
  execute_code:      ["shell", "filesystem"],
  version_control:   ["shell", "filesystem"],
  send_message:      ["messaging"],
  read_file:         ["filesystem"],
  write_file:        ["filesystem"],
  query_database:    ["data", "filesystem"],
};

/** 텍스트에서 의도 레이블을 추출. 패턴 모두 매칭 시 확정. */
export function extract_intents(text: string): string[] {
  const out: string[] = [];
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    if (patterns.every((re) => re.test(text))) {
      out.push(intent);
    }
  }
  return out;
}

/** 의도 레이블 목록에서 도구 카테고리를 수집. */
export function intents_to_categories(intents: string[]): string[] {
  const out = new Set<string>();
  for (const intent of intents) {
    for (const cat of INTENT_TO_TOOL_CATEGORIES[intent] ?? []) {
      out.add(cat);
    }
  }
  return [...out];
}

/** 텍스트에서 파일 확장자를 추출. */
export function extract_file_extensions(text: string): string[] {
  const matches = text.match(/\*?\.[a-z0-9]{1,10}\b/gi) || [];
  return [...new Set(matches.map((m) => m.toLowerCase()))];
}

/** 텍스트에서 코드 키워드/라이브러리명을 추출. */
const CODE_KEYWORDS = [
  "python", "javascript", "typescript", "java", "rust", "go", "ruby", "php",
  "pandas", "numpy", "react", "vue", "angular", "django", "flask", "fastapi",
  "sql", "sqlite", "postgres", "mysql", "redis", "mongodb",
  "docker", "kubernetes", "terraform", "ansible",
  "bash", "shell", "powershell",
  "node", "deno", "bun",
];

export function extract_code_hints(text: string): string[] {
  const lower = text.toLowerCase();
  return CODE_KEYWORDS.filter((kw) => lower.includes(kw));
}
