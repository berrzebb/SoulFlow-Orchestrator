/**
 * RP-2: ProtocolResolver 테스트.
 */

import { describe, it, expect } from "vitest";
import {
  create_protocol_resolver,
  type ProtocolSource,
} from "../../src/orchestration/protocol-resolver.js";

function make_source(protocols: Record<string, string>): ProtocolSource {
  const map = new Map(Object.entries(protocols));
  return {
    get_shared_protocol(name: string) {
      return map.get(name) || null;
    },
    list_shared_protocols() {
      return [...map.keys()];
    },
  };
}

describe("ProtocolResolver", () => {
  it("resolve → 존재하는 프로토콜만 반환", () => {
    const source = make_source({
      "clarification-protocol": "# 명확화 프로토콜\n질문을 먼저 한다.",
      "spp-deliberation": "# SPP\n단계별 사고.",
    });
    const resolver = create_protocol_resolver(source);
    const results = resolver.resolve(["clarification-protocol", "spp-deliberation"]);

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe("clarification-protocol");
    expect(results[0].content).toContain("명확화");
    expect(results[1].name).toBe("spp-deliberation");
  });

  it("resolve → 존재하지 않는 이름은 건너뜀", () => {
    const source = make_source({
      "clarification-protocol": "# 명확화",
    });
    const resolver = create_protocol_resolver(source);
    const results = resolver.resolve(["clarification-protocol", "nonexistent"]);

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("clarification-protocol");
  });

  it("resolve → 빈 배열 입력 → 빈 결과", () => {
    const source = make_source({ "proto": "content" });
    const resolver = create_protocol_resolver(source);
    expect(resolver.resolve([])).toHaveLength(0);
  });

  it("resolve_one → 존재하는 프로토콜 반환", () => {
    const source = make_source({
      "spp-deliberation": "# SPP 단계별 사고",
    });
    const resolver = create_protocol_resolver(source);
    const result = resolver.resolve_one("spp-deliberation");

    expect(result).not.toBeNull();
    expect(result!.name).toBe("spp-deliberation");
    expect(result!.content).toContain("SPP");
  });

  it("resolve_one → 존재하지 않는 이름 → null", () => {
    const source = make_source({});
    const resolver = create_protocol_resolver(source);
    expect(resolver.resolve_one("nonexistent")).toBeNull();
  });

  it("list_available → 등록된 프로토콜 이름 목록", () => {
    const source = make_source({
      "alpha": "A",
      "beta": "B",
      "gamma": "C",
    });
    const resolver = create_protocol_resolver(source);
    const names = resolver.list_available();

    expect(names).toContain("alpha");
    expect(names).toContain("beta");
    expect(names).toContain("gamma");
    expect(names).toHaveLength(3);
  });

  it("list_available → list_shared_protocols 미구현 시 빈 배열", () => {
    const source: ProtocolSource = {
      get_shared_protocol() { return null; },
    };
    const resolver = create_protocol_resolver(source);
    expect(resolver.list_available()).toHaveLength(0);
  });
});
