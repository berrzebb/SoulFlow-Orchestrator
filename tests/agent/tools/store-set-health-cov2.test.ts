/**
 * SqliteDynamicToolStore / SetTool / HealthcheckTool — 미커버 분기 보충.
 * Store: list/upsert/remove/signature, normalize_entry 엣지 케이스.
 * Set: parse_set fallback(쉼표), too-large set, cartesian too large, invalid b JSON.
 * Healthcheck: multi tcp endpoint, multi with valid endpoint mix.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, mkdirSync } from "node:fs";
import { SqliteDynamicToolStore } from "@src/agent/tools/store.js";
import type { DynamicToolManifestEntry } from "@src/agent/tools/dynamic.js";
import { SetTool } from "@src/agent/tools/set.js";
import { HealthcheckTool } from "@src/agent/tools/healthcheck.js";
import { with_sqlite } from "@src/utils/sqlite-helper.js";

// ══════════════════════════════════════════
// SqliteDynamicToolStore
// ══════════════════════════════════════════

function make_tool(name = "test_tool"): DynamicToolManifestEntry {
  return {
    name,
    description: "Test tool",
    enabled: true,
    kind: "shell",
    parameters: { type: "object" },
    command_template: "echo hello",
    working_dir: undefined,
    requires_approval: false,
  };
}

let tmp_dir: string;
let store: SqliteDynamicToolStore;

beforeEach(() => {
  tmp_dir = join(tmpdir(), `store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp_dir, { recursive: true });
  store = new SqliteDynamicToolStore(tmp_dir);
});

afterEach(() => {
  try { rmSync(tmp_dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("SqliteDynamicToolStore — get_path", () => {
  it("sqlite_path 반환", () => {
    expect(store.get_path()).toContain("tools.db");
  });
});

describe("SqliteDynamicToolStore — list_tools 빈 DB", () => {
  it("초기 상태 → 빈 배열", () => {
    expect(store.list_tools()).toEqual([]);
  });
});

describe("SqliteDynamicToolStore — upsert_tool", () => {
  it("새 도구 추가 → true 반환", () => {
    const result = store.upsert_tool(make_tool("my_tool"));
    expect(result).toBe(true);
  });

  it("추가 후 list_tools에 포함됨", () => {
    store.upsert_tool(make_tool("listed_tool"));
    const tools = store.list_tools();
    expect(tools.some((t) => t.name === "listed_tool")).toBe(true);
  });

  it("동일 name으로 upsert → 업데이트됨", () => {
    store.upsert_tool(make_tool("upd_tool"));
    const entry2 = make_tool("upd_tool");
    entry2.description = "Updated description";
    store.upsert_tool(entry2);
    const tools = store.list_tools();
    const found = tools.find((t) => t.name === "upd_tool");
    expect(found?.description).toBe("Updated description");
  });

  it("빈 name → false 반환 (추가 안 됨)", () => {
    const result = store.upsert_tool(make_tool(""));
    expect(result).toBe(false);
  });

  it("enabled=false 도구 추가", () => {
    const entry = make_tool("disabled_tool");
    entry.enabled = false;
    store.upsert_tool(entry);
    const found = store.list_tools().find((t) => t.name === "disabled_tool");
    expect(found?.enabled).toBe(false);
  });

  it("requires_approval=true 도구 추가", () => {
    const entry = make_tool("approval_tool");
    entry.requires_approval = true;
    store.upsert_tool(entry);
    const found = store.list_tools().find((t) => t.name === "approval_tool");
    expect(found?.requires_approval).toBe(true);
  });

  it("working_dir 포함 도구 추가", () => {
    const entry = make_tool("workdir_tool");
    entry.working_dir = "/tmp/workdir";
    store.upsert_tool(entry);
    const found = store.list_tools().find((t) => t.name === "workdir_tool");
    expect(found?.working_dir).toBe("/tmp/workdir");
  });
});

describe("SqliteDynamicToolStore — remove_tool", () => {
  it("존재하는 도구 제거 → true 반환", () => {
    store.upsert_tool(make_tool("to_remove"));
    expect(store.remove_tool("to_remove")).toBe(true);
  });

  it("제거 후 list에서 없어짐", () => {
    store.upsert_tool(make_tool("gone_tool"));
    store.remove_tool("gone_tool");
    expect(store.list_tools().some((t) => t.name === "gone_tool")).toBe(false);
  });

  it("존재하지 않는 도구 제거 → false 반환", () => {
    expect(store.remove_tool("nonexistent")).toBe(false);
  });

  it("빈 name 제거 → false 반환", () => {
    expect(store.remove_tool("")).toBe(false);
  });
});

describe("SqliteDynamicToolStore — signature", () => {
  it("빈 DB signature → '0:...' 형식", () => {
    const sig = store.signature();
    expect(sig.startsWith("0:")).toBe(true);
  });

  it("도구 추가 후 signature 변경", () => {
    const sig1 = store.signature();
    store.upsert_tool(make_tool("sig_tool"));
    const sig2 = store.signature();
    expect(sig1).not.toBe(sig2);
  });

  it("signature → 'count:hash' 형식", () => {
    store.upsert_tool(make_tool("s1"));
    store.upsert_tool(make_tool("s2"));
    const sig = store.signature();
    expect(sig.startsWith("2:")).toBe(true);
    expect(sig.length).toBeGreaterThan(4);
  });
});

describe("SqliteDynamicToolStore — sqlite_path_override", () => {
  it("sqlite_path_override 지정 시 해당 경로 사용", () => {
    const override = join(tmp_dir, "custom.db");
    const s2 = new SqliteDynamicToolStore(tmp_dir, override);
    expect(s2.get_path()).toBe(override);
  });
});

describe("SqliteDynamicToolStore — normalize_entry: parameters_json 잘못된 JSON (L31)", () => {
  it("잘못된 parameters_json → { type: 'object' } 폴백 (L31)", () => {
    // 정상 도구 추가 후 DB에서 직접 parameters_json을 잘못된 JSON으로 변경
    store.upsert_tool(make_tool("json_fallback_tool"));
    with_sqlite(store.get_path(), (db) => {
      db.prepare("UPDATE dynamic_tools SET parameters_json = ? WHERE name = ?")
        .run("{{{invalid json", "json_fallback_tool");
    });
    const tools = store.list_tools();
    const found = tools.find((t) => t.name === "json_fallback_tool");
    expect(found?.parameters).toEqual({ type: "object" });
  });
});

// ══════════════════════════════════════════
// SetTool — 미커버 분기
// ══════════════════════════════════════════

describe("SetTool — parse_set 쉼표 폴백", () => {
  it("JSON이 아닌 쉼표 구분 문자열도 파싱됨", async () => {
    const tool = new SetTool();
    // comma-separated fallback: parse_set tries JSON first (fails), then splits by comma
    const r = await tool.execute({ operation: "union", a: "apple,banana,cherry", b: "banana,date" });
    const arr = JSON.parse(r as string) as string[];
    expect(arr).toContain("apple");
    expect(arr).toContain("date");
  });
});

describe("SetTool — invalid b (non-array JSON)", () => {
  it("b가 객체 JSON → parse_set null → Error", async () => {
    const tool = new SetTool();
    // JSON.parse succeeds but not an array → parse_set returns null → Error
    const r = await tool.execute({ operation: "intersection", a: JSON.stringify([1, 2]), b: '{"key":"value"}' });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("'b'");
  });
});

describe("SetTool — set too large", () => {
  it("a 원소 100001개 초과 → Error", async () => {
    const tool = new SetTool();
    const large = JSON.stringify(Array.from({ length: 100_001 }, (_, i) => i));
    const r = await tool.execute({ operation: "union", a: large, b: "[]" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("exceeds");
  });

  it("b 원소 100001개 초과 → Error", async () => {
    const tool = new SetTool();
    const large = JSON.stringify(Array.from({ length: 100_001 }, (_, i) => i));
    const r = await tool.execute({ operation: "union", a: "[1]", b: large });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("exceeds");
  });
});

describe("SetTool — cartesian_product too large", () => {
  it("a × b > 100000 → Error", async () => {
    const tool = new SetTool();
    const big_a = JSON.stringify(Array.from({ length: 400 }, (_, i) => i));
    const big_b = JSON.stringify(Array.from({ length: 400 }, (_, i) => i));
    const r = await tool.execute({ operation: "cartesian_product", a: big_a, b: big_b });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("too large");
  });
});

// ══════════════════════════════════════════
// HealthcheckTool — 미커버 분기
// ══════════════════════════════════════════

describe("HealthcheckTool — multi tcp endpoint", () => {
  it("tcp endpoint → healthy 여부 포함", async () => {
    const tool = new HealthcheckTool();
    const endpoints = JSON.stringify([{ type: "tcp", host: "localhost", port: 1 }]);
    const result = await tool.execute({ action: "multi", endpoints, timeout_ms: 300 });
    const parsed = JSON.parse(result);
    expect(parsed.total).toBe(1);
    expect(typeof parsed.results[0].healthy).toBe("boolean");
    expect(parsed.results[0].host).toBe("localhost");
  });
});

describe("HealthcheckTool — multi mixed endpoints", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("http + dns + 잘못된 config 혼합", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    const endpoints = JSON.stringify([
      { type: "http", url: "http://example.com" },
      { type: "dns", host: "this-host-does-not-exist.invalid" },
      { type: "unknown" },
    ]);
    const result = await tool.execute({ action: "multi", endpoints });
    const parsed = JSON.parse(result);
    expect(parsed.total).toBe(3);
    expect(parsed.results[0].healthy).toBe(true);   // http 성공
    expect(parsed.results[1].healthy).toBe(false);  // dns 실패
    expect(parsed.results[2].healthy).toBe(false);  // invalid config
  });
});

const tool = new HealthcheckTool();

// ══════════════════════════════════════════
// 미커버 분기 보충 (L21, L23, L67)
// ══════════════════════════════════════════

describe("SqliteDynamicToolStore — normalize_entry L21/L23", () => {
  let tmp2: string;
  let s2: SqliteDynamicToolStore;

  beforeEach(() => {
    tmp2 = join(tmpdir(), `store-l21-${Date.now()}`);
    mkdirSync(tmp2, { recursive: true });
    s2 = new SqliteDynamicToolStore(tmp2);
  });

  afterEach(() => {
    try { rmSync(tmp2, { recursive: true, force: true }); } catch {}
  });

  it("name 빈 행 → normalize_entry L21 return null → list_tools에서 제외", () => {
    // name이 빈 문자열인 행을 DB에 직접 삽입
    with_sqlite(s2.get_path(), (db) => {
      db.prepare("INSERT OR REPLACE INTO dynamic_tools (name,description,enabled,kind,parameters_json,command_template,requires_approval,updated_at_ms) VALUES (?,?,?,?,?,?,?,?)")
        .run("", "desc", 1, "shell", "{}", "echo", 0, Date.now());
    });
    const tools = s2.list_tools();
    // name="" → normalize_entry returns null → filtered out
    expect(tools.find((t) => t.name === "")).toBeUndefined();
  });

  it("kind=python 행 → normalize_entry L23 return null → list_tools에서 제외", () => {
    with_sqlite(s2.get_path(), (db) => {
      db.prepare("INSERT OR REPLACE INTO dynamic_tools (name,description,enabled,kind,parameters_json,command_template,requires_approval,updated_at_ms) VALUES (?,?,?,?,?,?,?,?)")
        .run("python_tool", "desc", 1, "python", "{}", "python3 hello.py", 0, Date.now());
    });
    const tools = s2.list_tools();
    // kind="python" → normalize_entry returns null → filtered out
    expect(tools.find((t) => t.name === "python_tool")).toBeUndefined();
  });
});

describe("SqliteDynamicToolStore — remove_if_empty L67", () => {
  it("0바이트 파일 존재 시 생성자에서 삭제 후 재초기화", () => {
    const { writeFileSync } = require("node:fs");
    const tmp3 = join(tmpdir(), `store-l67-${Date.now()}`);
    mkdirSync(tmp3, { recursive: true });
    const db_path = join(tmp3, "runtime", "custom-tools", "tools.db");
    mkdirSync(require("node:path").dirname(db_path), { recursive: true });
    // 0바이트 파일 생성 → remove_if_empty → unlinkSync 호출 → L67 커버
    writeFileSync(db_path, "");
    const s3 = new SqliteDynamicToolStore(tmp3);
    expect(s3.get_path()).toBe(db_path);
    try { rmSync(tmp3, { recursive: true, force: true }); } catch {}
  });
});
