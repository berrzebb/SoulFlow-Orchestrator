/**
 * EmailTool — 검증 경로 테스트.
 * 실제 SMTP 연결 없이 입력 검증 분기만 커버.
 * send action 이외, 필수 필드 누락 케이스.
 */
import { describe, it, expect } from "vitest";
import { EmailTool } from "@src/agent/tools/email.js";

function make(): EmailTool {
  return new EmailTool();
}

describe("EmailTool — 입력 검증", () => {
  it("지원하지 않는 action → Error", async () => {
    const r = await make().execute({
      action: "list",
      to: "a@b.com", from: "b@c.com", subject: "test",
      body: "hello", smtp_host: "smtp.example.com",
    });
    expect(r).toContain("unsupported action");
  });

  it("to 없음 → Error", async () => {
    const r = await make().execute({
      action: "send",
      to: "", from: "b@c.com", subject: "test",
      body: "hello", smtp_host: "smtp.example.com",
    });
    expect(r).toContain("Error");
  });

  it("from 없음 → Error", async () => {
    const r = await make().execute({
      action: "send",
      to: "a@b.com", from: "", subject: "test",
      body: "hello", smtp_host: "smtp.example.com",
    });
    expect(r).toContain("Error");
  });

  it("smtp_host 없음 → Error", async () => {
    const r = await make().execute({
      action: "send",
      to: "a@b.com", from: "b@c.com", subject: "test",
      body: "hello", smtp_host: "",
    });
    expect(r).toContain("Error");
  });
});
