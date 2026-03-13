/**
 * SseManager — team-scoped delivery 테스트.
 * Step 3: SseClient에 team_id를 추가하고, broadcast_scoped로 팀별 전달.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SseManager } from "@src/dashboard/sse-manager.ts";
import { make_mock_response } from "@helpers/mock-response.ts";

describe("SseManager team-scoped delivery", () => {
  let sse: SseManager;

  beforeEach(() => {
    sse = new SseManager();
  });

  it("add_client에 team_id를 전달할 수 있다", () => {
    const res = make_mock_response();
    sse.add_client(res as any, "team-alpha");
    expect(sse.client_count).toBe(1);
  });

  it("broadcast_task_event는 해당 팀 클라이언트에만 전달", () => {
    const res_a = make_mock_response();
    const res_b = make_mock_response();
    sse.add_client(res_a as any, "team-alpha");
    sse.add_client(res_b as any, "team-beta");

    sse.broadcast_task_event("status_change", {
      taskId: "t1",
      team_id: "team-alpha",
      title: "Test",
      objective: "obj",
      channel: "ch",
      chatId: "c1",
      currentTurn: 1,
      maxTurns: 10,
      status: "running",
      memory: {},
    });

    // team-alpha 클라이언트만 수신
    expect(res_a.write).toHaveBeenCalledTimes(2); // ready + task event
    expect(res_b.write).toHaveBeenCalledTimes(1); // ready only
  });

  it("broadcast_process_event는 해당 팀 클라이언트에만 전달", () => {
    const res_a = make_mock_response();
    const res_b = make_mock_response();
    sse.add_client(res_a as any, "team-alpha");
    sse.add_client(res_b as any, "team-beta");

    sse.broadcast_process_event("start", {
      run_id: "r1",
      alias: "a",
      mode: "once",
      status: "running",
      started_at: "",
      team_id: "team-alpha",
    } as any);

    expect(res_a.write).toHaveBeenCalledTimes(2); // ready + process
    expect(res_b.write).toHaveBeenCalledTimes(1); // ready only
  });

  it("team_id 없는 클라이언트는 모든 이벤트 수신 (superadmin)", () => {
    const res_super = make_mock_response();
    const res_a = make_mock_response();
    sse.add_client(res_super as any); // no team_id = superadmin/single-user
    sse.add_client(res_a as any, "team-alpha");

    sse.broadcast_task_event("status_change", {
      taskId: "t1",
      team_id: "team-alpha",
      title: "Test",
      objective: "",
      channel: "ch",
      chatId: "c1",
      currentTurn: 0,
      maxTurns: 10,
      status: "running",
      memory: {},
    });

    expect(res_super.write).toHaveBeenCalledTimes(2); // ready + task
    expect(res_a.write).toHaveBeenCalledTimes(2); // ready + task
  });

  it("broadcast_message_event에 team_id가 RecentMessage에 저장", () => {
    sse.broadcast_message_event("inbound", "user1", "hello", "chat1", "team-x");
    expect(sse.recent_messages).toHaveLength(1);
    expect(sse.recent_messages[0].team_id).toBe("team-x");
  });
});
