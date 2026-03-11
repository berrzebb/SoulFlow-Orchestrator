/**
 * FTS 쿼리 확장 — 불용어 제거 + 한국어 조사 탈락 + CJK 바이그램.
 * 임베딩 불가 환경의 FTS-only 검색, 또는 하이브리드 FTS 경로에서 사용.
 */

// ── 불용어 사전 ──────────────────────────────────────────────────────────────

const STOP_WORDS_EN = new Set([
  "a","an","the","this","that","these","those",
  "i","me","my","we","our","you","your","he","she","it","they","them",
  "is","are","was","were","be","been","being","have","has","had",
  "do","does","did","will","would","could","should","can","may","might",
  "in","on","at","to","for","of","with","by","from","about","into",
  "through","during","before","after","above","below","between","under","over",
  "and","or","but","if","then","because","as","while","when","where",
  "what","which","who","how","why","please","help","find","show","get","tell","give",
  "yesterday","today","tomorrow","earlier","later","recently","just","now",
  "thing","things","stuff","something","anything","everything","nothing",
]);

const STOP_WORDS_KO = new Set([
  // 조사
  "은","는","이","가","을","를","의","에","에서","로","으로","와","과",
  "도","만","까지","부터","한테","에게","께","처럼","같이","보다",
  "마다","밖에","대로",
  // 대명사
  "나","나는","내가","나를","너","우리","저","저희","그","그녀","그들",
  "이것","저것","그것","여기","저기","거기",
  // 보조동사/일반동사
  "있다","없다","하다","되다","이다","아니다","보다","주다","오다","가다",
  // 의존명사/불특정 명사
  "것","거","등","수","때","곳","중","분",
  // 부사
  "잘","더","또","매우","정말","아주","많이","너무","좀",
  // 접속사
  "그리고","하지만","그래서","그런데","그러나","또는","그러면",
  // 의문사
  "왜","어떻게","뭐","언제","어디","누구","무엇","어떤",
  // 시간 (모호)
  "어제","오늘","내일","최근","지금","아까","나중","전에",
  // 요청어
  "제발","부탁",
]);

// ── 한국어 조사 탈락 ────────────────────────────────────────────────────────

const KO_TRAILING_PARTICLES = [
  "에서","으로","에게","한테","처럼","같이","보다","까지","부터","마다","밖에","대로",
  "은","는","이","가","을","를","의","에","로","와","과","도","만",
].sort((a, b) => b.length - a.length); // 긴 것부터 매칭

function strip_ko_particle(token: string): string | null {
  for (const p of KO_TRAILING_PARTICLES) {
    if (token.length > p.length && token.endsWith(p)) return token.slice(0, -p.length);
  }
  return null;
}

function is_useful_ko_stem(stem: string): boolean {
  if (/[\uac00-\ud7af]/.test(stem)) return stem.length >= 2;
  return /^[a-z0-9_]+$/i.test(stem);
}

// ── 유효 키워드 판별 ─────────────────────────────────────────────────────────

function is_valid_keyword(token: string): boolean {
  if (!token || token.length === 0) return false;
  if (/^[a-zA-Z]+$/.test(token) && token.length < 3) return false;
  if (/^\d+$/.test(token)) return false;
  if (/^[\p{P}\p{S}]+$/u.test(token)) return false;
  return true;
}

// ── 토크나이저 ───────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const normalized = text.toLowerCase().trim();
  const segments = normalized.split(/[\s\p{P}]+/u).filter(Boolean);

  for (const seg of segments) {
    if (/[\uac00-\ud7af\u3131-\u3163]/.test(seg)) {
      // 한국어: 조사 탈락 스템 추가
      const stem = strip_ko_particle(seg);
      const stem_is_stop = stem !== null && STOP_WORDS_KO.has(stem);
      if (!STOP_WORDS_KO.has(seg) && !stem_is_stop) tokens.push(seg);
      if (stem && !STOP_WORDS_KO.has(stem) && is_useful_ko_stem(stem)) tokens.push(stem);
    } else if (/[\u4e00-\u9fff]/.test(seg)) {
      // 중국어: 유니그램 + 바이그램
      const chars = Array.from(seg).filter((c) => /[\u4e00-\u9fff]/.test(c));
      tokens.push(...chars);
      for (let i = 0; i < chars.length - 1; i++) tokens.push(chars[i] + chars[i + 1]);
    } else {
      tokens.push(seg);
    }
  }
  return tokens;
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

/** 쿼리에서 의미 있는 키워드를 추출. FTS 조건에 쓸 용도. */
export function extract_query_keywords(query: string): string[] {
  const tokens = tokenize(query);
  const keywords: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    if (STOP_WORDS_EN.has(token)) continue;
    if (STOP_WORDS_KO.has(token)) continue;
    if (!is_valid_keyword(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    keywords.push(token);
  }
  return keywords;
}

/**
 * FTS5 MATCH 쿼리 생성.
 * 키워드 추출 성공 시 OR 결합 → 더 넓은 매칭.
 * 모두 불용어인 경우 원문 AND 쿼리로 폴백.
 */
export function build_fts_query_expanded(query: string): string {
  const keywords = extract_query_keywords(query);
  if (keywords.length > 0) {
    return keywords.map((k) => `"${k.replace(/"/g, '""')}"`).join(" OR ");
  }
  // 폴백: 원문 AND 쿼리
  const terms = String(query || "").split(/\s+/).map((v) => v.trim()).filter(Boolean);
  if (terms.length === 0) return "";
  return terms.map((v) => `"${v.replace(/"/g, '""')}"`).join(" ");
}
