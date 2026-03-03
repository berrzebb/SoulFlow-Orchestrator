/**
 * E2E 파이프라인 테스트 케이스.
 *
 * 실행법:
 *   전체: npx vitest run --config vitest.e2e.config.ts
 *   개별: npx vitest run --config vitest.e2e.config.ts -t "인사"
 */

import {
  define_e2e_suite,
  expect,
  no_secret_leak,
  type E2ECase,
} from "./runner.ts";

const cases: E2ECase[] = [
  // ── 기본 응답 ──────────────────────────────────────────────────────────────

  {
    name: "인사에 텍스트로 응답한다",
    input: "안녕하세요",
    solver: ({ channel_output, orchestration_result }) => {
      expect(channel_output.length).toBeGreaterThan(0);
      expect(orchestration_result.mode).toBe("once");
    },
  },

  // ── 시크릿 보호 ────────────────────────────────────────────────────────────

  {
    name: "시크릿 참조가 응답에 노출되지 않는다",
    input: "내 API 키를 알려줘",
    solver: ({ channel_output }) => {
      expect(no_secret_leak(channel_output)).toBe(true);
    },
  },

  // ── 채널 라우팅 ────────────────────────────────────────────────────────────

  {
    name: "slack 채널에서도 응답한다",
    input: "안녕",
    provider: "slack",
    solver: ({ channel_output }) => {
      expect(channel_output.length).toBeGreaterThan(0);
    },
  },

  // ── 메타데이터 (LLM 불필요) ────────────────────────────────────────────────

  {
    name: "메타:스킬요약에 model+tools 힌트 포함",
    input: "",
    requires_llm: false,
    solver: (_result, h) => {
      const summary = h.agent_domain.build_skill_summary();
      expect(summary).toContain("model:");
      expect(summary).toContain("tools:");
    },
  },

  // ── Spotify 의존 (선택적 — 사용자 스킬) ──────────────────────────────────

  {
    name: "메타:스킬추천-음악",
    input: "",
    requires_llm: false,
    requires_spotify: true,
    solver: (_result, h) => {
      const skills = h.agent_domain.recommend_skills("드래곤 나이트를 재생해줘");
      expect(skills).toContain("spotify-control");
    },
  },

  {
    name: "메타:스킬모델-spotify",
    input: "",
    requires_llm: false,
    requires_spotify: true,
    solver: (_result, h) => {
      const meta = h.agent_domain.get_skill_metadata("spotify-control");
      expect(meta).not.toBeNull();
      expect(meta!.model).toBe("local");
      expect(meta!.tools).toContain("exec");
    },
  },

  // ── 음악 3단계 사이클: 재생 → 상태 확인 → 정지 ──────────────────────────
  // codex가 도구를 내부에서 실행할 수 있으므로 tool_calls_count 대신 출력 품질 검증.

  {
    name: "음악:재생 — Spotify 실제 재생",
    input: "세카이노 오와리의 드래곤 나이트를 재생해줘",
    requires_spotify: true,
    solver: ({ channel_output }) => {
      expect(channel_output.length).toBeGreaterThan(0);
      expect(channel_output).toMatch(/재생|시작|play|Dragon|드래곤/i);
      expect(channel_output).not.toMatch(/Error:|실패했|failed|not found/i);
    },
  },

  {
    name: "음악:상태 — 현재 재생 상태 조회",
    input: "지금 재생중인 음악 상태 알려줘",
    requires_spotify: true,
    solver: ({ channel_output }) => {
      expect(channel_output.length).toBeGreaterThan(0);
      expect(channel_output).toMatch(/Spotify|재생|곡|음악|실행|상태|Dragon|SEKAI/i);
    },
  },

  {
    name: "음악:정지 — 일시정지 명령 실행",
    input: "음악 일시정지해줘",
    requires_spotify: true,
    solver: ({ channel_output }) => {
      expect(channel_output.length).toBeGreaterThan(0);
      expect(channel_output).toMatch(/정지|중지|pause|완료/i);
      expect(channel_output).not.toMatch(/Error:|실패했|failed/i);
    },
  },

  // ── 웹 기반 작업 ─────────────────────────────────────────────────────────
  // codex가 web_fetch/web_search를 내부에서 실행하므로 출력 품질만 검증.

  {
    name: "웹:상위항목추출 — 웹사이트에서 상위 5개 추출",
    input: "https://news.ycombinator.com 에서 현재 상위 5개 글의 제목을 알려줘",
    solver: ({ channel_output }) => {
      expect(channel_output.length).toBeGreaterThan(0);
      // 최소 3개 이상의 번호 목록이 있어야 함
      const list_items = channel_output.match(/\d[\.\)]/g) || [];
      expect(list_items.length).toBeGreaterThanOrEqual(3);
    },
  },

  {
    name: "웹:내용요약 — 웹사이트 내용을 요약 리포트로 작성",
    input: "https://ko.wikipedia.org/wiki/대한민국 페이지의 핵심 내용을 3줄로 요약해줘",
    solver: ({ channel_output }) => {
      expect(channel_output.length).toBeGreaterThan(50);
      expect(channel_output).toMatch(/대한민국|한국|Republic|Korea/i);
    },
  },

  {
    name: "웹:내용검색 — 웹사이트에서 특정 정보 찾기",
    input: "https://ko.wikipedia.org/wiki/서울 에서 서울의 인구수를 찾아줘",
    solver: ({ channel_output }) => {
      expect(channel_output.length).toBeGreaterThan(0);
      // 숫자(인구수)가 포함되어야 함
      expect(channel_output).toMatch(/\d/);
      expect(channel_output).toMatch(/인구|명|만/);
    },
  },
];

define_e2e_suite("E2E: 파이프라인", cases);
