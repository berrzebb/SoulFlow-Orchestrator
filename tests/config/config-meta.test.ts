/**
 * config-meta — 유틸리티 함수 및 상수 테스트.
 */
import { describe, it, expect } from "vitest";
import {
  CONFIG_FIELDS,
  SECTION_LABELS,
  SECTION_ORDER,
  get_fields_by_section,
  get_sensitive_fields,
  to_vault_name,
} from "../../src/config/config-meta.js";

describe("config-meta", () => {
  it("CONFIG_FIELDS: 최소 1개 이상 필드 존재", () => {
    expect(CONFIG_FIELDS.length).toBeGreaterThan(0);
  });

  it("CONFIG_FIELDS: 모든 필드에 필수 속성 존재", () => {
    for (const f of CONFIG_FIELDS) {
      expect(f.path).toBeTruthy();
      expect(f.label).toBeTruthy();
      expect(f.section).toBeTruthy();
      expect(["string", "number", "boolean", "select"]).toContain(f.type);
      expect(typeof f.sensitive).toBe("boolean");
      expect(typeof f.restart_required).toBe("boolean");
    }
  });

  it("SECTION_LABELS: 모든 SECTION_ORDER 항목에 라벨 존재", () => {
    for (const section of SECTION_ORDER) {
      expect(SECTION_LABELS[section]).toBeTruthy();
    }
  });

  it("get_fields_by_section: 모든 필드가 그룹핑됨", () => {
    const map = get_fields_by_section();
    let total = 0;
    for (const [, fields] of map) total += fields.length;
    expect(total).toBe(CONFIG_FIELDS.length);
  });

  it("get_fields_by_section: general 섹션에 agentLoopMaxTurns 포함", () => {
    const map = get_fields_by_section();
    const general = map.get("general") ?? [];
    expect(general.some(f => f.path === "agentLoopMaxTurns")).toBe(true);
  });

  it("get_sensitive_fields: 민감 필드만 반환", () => {
    const sensitive = get_sensitive_fields();
    for (const f of sensitive) {
      expect(f.sensitive).toBe(true);
    }
  });

  it("to_vault_name: path에 config. 접두사 추가", () => {
    expect(to_vault_name("channels.slack.botToken")).toBe("config.channels.slack.botToken");
    expect(to_vault_name("api.key")).toBe("config.api.key");
  });
});
