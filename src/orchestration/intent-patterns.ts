/** Intent 정규식 + 파일/코드 패턴 추출 유틸. LLM 호출 없이 규칙 기반. */

export const INTENT_PATTERNS: Record<string, RegExp[]> = {
  generate_document: [/만들어|생성|작성|create|generate|make/i, /파일|문서|보고서|report|file|document/i],
  analyze_data: [/분석|통계|요약|데이터|analyze|analysis|data|statistics/i],
  search_web: [/검색|찾아|search|find|look up/i],
  execute_code: [/실행|코드|스크립트|run|execute|script/i],
  version_control: [/커밋|PR|이슈|브랜치|commit|branch|push|pull request/i],
  send_message: [/전송|보내|알림|메시지|send|notify|message/i],
  read_file: [/읽어|열어|확인|open|read|show|view/i, /파일|file/i],
  write_file: [/저장|쓰기|편집|수정|save|write|edit/i, /파일|file/i],
  query_database: [/쿼리|조회|데이터베이스|query|select|database/i],
};

/** 텍스트에서 의도 레이블을 추출. 패턴 2개 모두 매칭 시 확정. */
export function extract_intents(text: string): string[] {
  const out: string[] = [];
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    if (patterns.every((re) => re.test(text))) {
      out.push(intent);
    }
  }
  return out;
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
