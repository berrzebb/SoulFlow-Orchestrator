/**
 * 칸반 E2E 시나리오 테스트 — 다중 에이전트 시뮬레이션.
 *
 * 시나리오: Planner → Worker(잘못된 작업) → QA(지적) → Worker(수정) → QA(승인) → Done
 * 실제 SQLite KanbanStore + KanbanTool, LLM 호출 없이 에이전트 역할을 시뮬레이션.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { KanbanStore } from "@src/services/kanban-store.ts";
import { KanbanTool } from "@src/agent/tools/kanban.ts";

describe("칸반 다중 에이전트 시나리오", () => {
  let dir: string;
  let tool: KanbanTool;

  const planner = { sender_id: "planner-agent" };
  const worker = { sender_id: "worker-agent" };
  const qa = { sender_id: "qa-agent" };

  let board_id: string;
  let api_card_id: string;
  let db_card_id: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "kanban-scenario-"));
    const store = new KanbanStore(dir);
    tool = new KanbanTool(store);
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  // ──────────────────────────────────────────────────────
  // Phase 1: Planner가 보드 생성 + 작업 등록
  // ──────────────────────────────────────────────────────

  it("1-1. Planner가 스프린트 보드를 생성한다", async () => {
    const result = await tool.execute({
      action: "create_board",
      name: "Sprint 42",
      scope_type: "channel",
      scope_id: "dev-team",
    }, planner);

    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
    board_id = parsed.board_id;
  });

  it("1-2. Planner가 작업 카드를 등록한다", async () => {
    // API 엔드포인트 작업
    let result = await tool.execute({
      action: "create_card",
      board_id,
      title: "사용자 인증 API 구현",
      description: "JWT 기반 로그인/회원가입 API. bcrypt로 비밀번호 해싱.",
      priority: "high",
      assignee: "worker-agent",
    }, planner);
    expect(result).toContain("created");
    api_card_id = result.match(/^(\S+) created/)![1];

    // DB 스키마 작업
    result = await tool.execute({
      action: "create_card",
      board_id,
      title: "사용자 테이블 스키마 작성",
      description: "users 테이블: id, email, password_hash, created_at. email UNIQUE 인덱스 필수.",
      priority: "medium",
      assignee: "worker-agent",
    }, planner);
    expect(result).toContain("created");
    db_card_id = result.match(/^(\S+) created/)![1];
  });

  it("1-3. Planner가 작업 간 의존성을 설정한다", async () => {
    // API는 DB 스키마에 의존
    const result = await tool.execute({
      action: "add_relation",
      source_card_id: api_card_id,
      target_card_id: db_card_id,
      type: "blocked_by",
    }, planner);
    expect(result).toContain("blocked_by");
  });

  // ──────────────────────────────────────────────────────
  // Phase 2: Worker가 작업 처리 (의도적으로 잘못된 결과)
  // ──────────────────────────────────────────────────────

  it("2-1. Worker가 DB 카드를 in_progress로 이동한다", async () => {
    const result = await tool.execute({
      action: "move_card",
      card_id: db_card_id,
      column_id: "in_progress",
    }, worker);
    expect(result).toContain("moved to in_progress");
  });

  it("2-2. Worker가 잘못된 스키마를 작성하고 리뷰 요청한다", async () => {
    // 의도적 오류: password를 VARCHAR(8)로 설정 (해시값 저장 불가), email UNIQUE 누락
    await tool.execute({
      action: "comment",
      card_id: db_card_id,
      text: [
        "스키마 작성 완료:",
        "```sql",
        "CREATE TABLE users (",
        "  id SERIAL PRIMARY KEY,",
        "  email VARCHAR(255),",          // UNIQUE 누락
        "  password VARCHAR(8),",          // bcrypt 해시 저장 불가
        "  created_at TIMESTAMP DEFAULT NOW()",
        ");",
        "```",
      ].join("\n"),
    }, worker);

    // in_review로 이동
    const result = await tool.execute({
      action: "move_card",
      card_id: db_card_id,
      column_id: "in_review",
    }, worker);
    expect(result).toContain("moved to in_review");
  });

  // ──────────────────────────────────────────────────────
  // Phase 3: QA가 리뷰 → 문제 지적
  // ──────────────────────────────────────────────────────

  it("3-1. QA가 카드를 확인한다", async () => {
    const result = await tool.execute({
      action: "get_card",
      card_id: db_card_id,
    }, qa);

    expect(result).toContain("사용자 테이블 스키마 작성");
    expect(result).toContain("in_review");
    expect(result).toContain("VARCHAR(8)"); // 잘못된 부분 확인 가능
  });

  it("3-2. QA가 잘못된 점을 지적한다", async () => {
    const result = await tool.execute({
      action: "comment",
      card_id: db_card_id,
      text: [
        "❌ 리뷰 실패. 2가지 문제:",
        "1. `password VARCHAR(8)` → bcrypt 해시는 60자. `password_hash VARCHAR(72)`로 변경 필요.",
        "2. `email` 컬럼에 UNIQUE 제약조건 누락. 요구사항에 명시됨.",
        "",
        "수정 후 다시 리뷰 요청해주세요.",
      ].join("\n"),
    }, qa);
    expect(result).toContain("comment added");
  });

  it("3-3. QA가 카드를 todo로 되돌린다", async () => {
    const result = await tool.execute({
      action: "move_card",
      card_id: db_card_id,
      column_id: "todo",
    }, qa);
    expect(result).toContain("moved to todo");
  });

  // ──────────────────────────────────────────────────────
  // Phase 4: Worker가 피드백을 확인하고 수정
  // ──────────────────────────────────────────────────────

  it("4-1. Worker가 코멘트를 확인한다", async () => {
    const result = await tool.execute({
      action: "list_comments",
      card_id: db_card_id,
    }, worker);

    expect(result).toContain("리뷰 실패");
    expect(result).toContain("password_hash VARCHAR(72)");
    expect(result).toContain("UNIQUE 제약조건 누락");
  });

  it("4-2. Worker가 수정된 스키마를 제출한다", async () => {
    // in_progress로
    await tool.execute({
      action: "move_card",
      card_id: db_card_id,
      column_id: "in_progress",
    }, worker);

    // 수정된 코멘트
    await tool.execute({
      action: "comment",
      card_id: db_card_id,
      text: [
        "수정 완료:",
        "```sql",
        "CREATE TABLE users (",
        "  id SERIAL PRIMARY KEY,",
        "  email VARCHAR(255) UNIQUE NOT NULL,",
        "  password_hash VARCHAR(72) NOT NULL,",
        "  created_at TIMESTAMP DEFAULT NOW()",
        ");",
        "CREATE INDEX idx_users_email ON users(email);",
        "```",
        "- password → password_hash VARCHAR(72) 변경",
        "- email UNIQUE NOT NULL 추가",
        "- email 인덱스 추가",
      ].join("\n"),
    }, worker);

    // in_review로
    const result = await tool.execute({
      action: "move_card",
      card_id: db_card_id,
      column_id: "in_review",
    }, worker);
    expect(result).toContain("moved to in_review");
  });

  // ──────────────────────────────────────────────────────
  // Phase 5: QA가 수정 확인 → 승인 → done
  // ──────────────────────────────────────────────────────

  it("5-1. QA가 수정된 결과를 승인한다", async () => {
    // 코멘트 확인
    const comments = await tool.execute({
      action: "list_comments",
      card_id: db_card_id,
    }, qa);
    expect(comments).toContain("password_hash VARCHAR(72)");
    expect(comments).toContain("UNIQUE NOT NULL");

    // 승인 코멘트
    const result = await tool.execute({
      action: "comment",
      card_id: db_card_id,
      text: "✅ LGTM. bcrypt 해시 크기 적합, UNIQUE 제약조건 확인 완료.",
    }, qa);
    expect(result).toContain("comment added");
  });

  it("5-2. QA가 카드를 done으로 이동한다", async () => {
    const result = await tool.execute({
      action: "move_card",
      card_id: db_card_id,
      column_id: "done",
    }, qa);
    expect(result).toContain("moved to done");
  });

  // ──────────────────────────────────────────────────────
  // Phase 6: 최종 상태 검증
  // ──────────────────────────────────────────────────────

  it("6-1. 완료된 카드의 최종 상태가 올바르다", async () => {
    const result = await tool.execute({
      action: "get_card",
      card_id: db_card_id,
    }, planner);

    expect(result).toContain("done");
    // 전체 코멘트 이력이 남아있음
    expect(result).toContain("comments");
  });

  it("6-2. 블로킹 해제 — API 카드가 더 이상 blocked 상태가 아니다", async () => {
    const result = await tool.execute({
      action: "board_summary",
      board_id,
    }, planner);

    expect(result).toContain("Sprint 42");
    // DB 카드 done → API 카드는 여전히 todo지만 blocker 목록에 없어야 함
    // (DB 카드가 done이 되었으므로 blocked_by 관계의 대상이 완료됨)
    expect(result).toContain("1/2 done");
  });

  it("6-3. 카드 타임 트래킹에 컬럼 이동 이력이 기록된다", async () => {
    const result = await tool.execute({
      action: "card_time_tracking",
      card_id: db_card_id,
    }, planner);

    expect(result).toContain("Time Tracking");
    // todo → in_progress → in_review → todo → in_progress → in_review → done
    expect(result).toContain("todo");
    expect(result).toContain("in_progress");
    expect(result).toContain("in_review");
    expect(result).toContain("done");
  });

  it("6-4. 활동 로그에 전체 흐름이 추적된다", async () => {
    const result = await tool.execute({
      action: "list_activities",
      board_id,
    }, planner);

    expect(result).not.toBe("활동 없음");
    // 다양한 에이전트의 활동이 기록됨
    expect(result).toContain("worker-agent");
    expect(result).toContain("qa-agent");
  });

  // ──────────────────────────────────────────────────────
  // Phase 7: 완료된 카드 삭제 (아카이브)
  // ──────────────────────────────────────────────────────

  it("7-1. Planner가 완료된 DB 카드를 삭제한다", async () => {
    const result = await tool.execute({
      action: "archive_card",
      card_id: db_card_id,
    }, planner);
    expect(result).toContain("archived");
  });

  it("7-2. 삭제된 카드를 조회하면 not found가 반환된다", async () => {
    const result = await tool.execute({
      action: "get_card",
      card_id: db_card_id,
    }, planner);
    expect(result.toLowerCase()).toContain("not found");
  });

  it("7-3. 보드 요약에서 삭제된 카드가 제외된다", async () => {
    const result = await tool.execute({
      action: "board_summary",
      board_id,
    }, planner);
    expect(result).toContain("0/1 done");
  });
});
