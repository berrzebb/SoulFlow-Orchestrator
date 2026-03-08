/**
 * OpenApiTool — 6개 액션 완전 커버리지.
 */
import { describe, it, expect } from "vitest";
import { OpenApiTool } from "@src/agent/tools/openapi.js";

const tool = new OpenApiTool();

// ── 샘플 OpenAPI 스펙 ──────────────────────────────────

const SIMPLE_SPEC = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Pet API", version: "1.0.0", description: "Pet store API" },
  servers: [{ url: "https://api.pets.com" }],
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        summary: "List all pets",
        tags: ["pets"],
        parameters: [{ name: "limit", in: "query", required: false, description: "Max results" }],
        responses: { "200": { description: "OK" } },
      },
      post: {
        operationId: "createPet",
        summary: "Create a pet",
        tags: ["pets"],
        responses: { "201": { description: "Created" } },
      },
    },
    "/pets/{id}": {
      get: {
        operationId: "getPet",
        summary: "Get pet by ID",
        tags: ["pets"],
        responses: { "200": { description: "OK" } },
      },
      put: {
        operationId: "updatePet",
        responses: { "200": { description: "OK" } },
      },
      delete: {
        operationId: "deletePet",
        responses: { "204": { description: "No content" } },
      },
    },
  },
  tags: [{ name: "pets" }],
});

const INVALID_SPEC = `{ "openapi": 3 }`; // invalid value but valid JSON
const BAD_JSON = "not json at all";

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("OpenApiTool — 메타데이터", () => {
  it("name = openapi", () => expect(tool.name).toBe("openapi"));
  it("category = data", () => expect(tool.category).toBe("data"));
  it("to_schema: function 형식", () => expect(tool.to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// parse
// ══════════════════════════════════════════

describe("OpenApiTool — parse", () => {
  it("유효한 스펙 → openapi/info/servers/paths_count 반환", async () => {
    const r = await tool.execute({ action: "parse", spec: SIMPLE_SPEC });
    const parsed = JSON.parse(r);
    expect(parsed.openapi).toBe("3.0.0");
    expect(parsed.info.title).toBe("Pet API");
    expect(parsed.paths_count).toBe(2);
    expect(Array.isArray(parsed.tags)).toBe(true);
    expect(parsed.tags).toContain("pets");
  });

  it("swagger 스펙 → swagger 버전 반환", async () => {
    const spec = JSON.stringify({ swagger: "2.0", info: { title: "Old API", version: "2.0" }, paths: {} });
    const r = await tool.execute({ action: "parse", spec });
    const parsed = JSON.parse(r);
    expect(parsed.openapi).toBe("2.0");
  });

  it("빈 paths → paths_count=0", async () => {
    const spec = JSON.stringify({ openapi: "3.0.0", info: {}, paths: {} });
    const r = await tool.execute({ action: "parse", spec });
    const parsed = JSON.parse(r);
    expect(parsed.paths_count).toBe(0);
  });

  it("유효하지 않은 JSON → error 반환", async () => {
    const r = await tool.execute({ action: "parse", spec: BAD_JSON });
    const parsed = JSON.parse(r);
    expect(parsed.error).toContain("invalid spec JSON");
  });
});

// ══════════════════════════════════════════
// list_endpoints
// ══════════════════════════════════════════

describe("OpenApiTool — list_endpoints", () => {
  it("엔드포인트 목록 반환", async () => {
    const r = await tool.execute({ action: "list_endpoints", spec: SIMPLE_SPEC });
    const parsed = JSON.parse(r);
    expect(parsed.count).toBe(5);
    expect(parsed.endpoints.some((e: { method: string }) => e.method === "GET")).toBe(true);
    expect(parsed.endpoints.some((e: { method: string }) => e.method === "POST")).toBe(true);
    expect(parsed.endpoints.some((e: { method: string }) => e.method === "DELETE")).toBe(true);
  });

  it("경로와 메서드 포함", async () => {
    const r = await tool.execute({ action: "list_endpoints", spec: SIMPLE_SPEC });
    const parsed = JSON.parse(r);
    expect(parsed.endpoints.some((e: { path: string }) => e.path === "/pets")).toBe(true);
    expect(parsed.endpoints.some((e: { path: string }) => e.path === "/pets/{id}")).toBe(true);
  });

  it("summary와 tags 포함", async () => {
    const r = await tool.execute({ action: "list_endpoints", spec: SIMPLE_SPEC });
    const parsed = JSON.parse(r);
    const listPets = parsed.endpoints.find((e: { method: string; path: string }) => e.method === "GET" && e.path === "/pets");
    expect(listPets.summary).toBe("List all pets");
    expect(listPets.tags).toContain("pets");
  });

  it("paths 없음 → count=0", async () => {
    const spec = JSON.stringify({ openapi: "3.0.0", info: {} });
    const r = await tool.execute({ action: "list_endpoints", spec });
    const parsed = JSON.parse(r);
    expect(parsed.count).toBe(0);
  });
});

// ══════════════════════════════════════════
// get_operation
// ══════════════════════════════════════════

describe("OpenApiTool — get_operation", () => {
  it("경로 + 메서드 → 오퍼레이션 반환", async () => {
    const r = await tool.execute({ action: "get_operation", spec: SIMPLE_SPEC, path: "/pets", method: "get" });
    const parsed = JSON.parse(r);
    expect(parsed.operationId).toBe("listPets");
    expect(parsed.summary).toBe("List all pets");
  });

  it("존재하지 않는 경로 → error 반환", async () => {
    const r = await tool.execute({ action: "get_operation", spec: SIMPLE_SPEC, path: "/unknown", method: "get" });
    const parsed = JSON.parse(r);
    expect(parsed.error).toContain("path not found");
  });

  it("존재하지 않는 메서드 → error 반환", async () => {
    const r = await tool.execute({ action: "get_operation", spec: SIMPLE_SPEC, path: "/pets", method: "patch" });
    const parsed = JSON.parse(r);
    expect(parsed.error).toContain("method not found");
  });
});

// ══════════════════════════════════════════
// validate
// ══════════════════════════════════════════

describe("OpenApiTool — validate", () => {
  it("유효한 스펙 → valid=true, errors=[]", async () => {
    const r = await tool.execute({ action: "validate", spec: SIMPLE_SPEC });
    const parsed = JSON.parse(r);
    expect(parsed.valid).toBe(true);
    expect(parsed.errors).toHaveLength(0);
  });

  it("openapi 버전 없음 → error 포함", async () => {
    const spec = JSON.stringify({ info: {}, paths: {} });
    const r = await tool.execute({ action: "validate", spec });
    const parsed = JSON.parse(r);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.some((e: string) => e.includes("openapi"))).toBe(true);
  });

  it("info 없음 → error 포함", async () => {
    const spec = JSON.stringify({ openapi: "3.0.0", paths: {} });
    const r = await tool.execute({ action: "validate", spec });
    const parsed = JSON.parse(r);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.some((e: string) => e.includes("info"))).toBe(true);
  });

  it("paths 없음 → error 포함", async () => {
    const spec = JSON.stringify({ openapi: "3.0.0", info: {} });
    const r = await tool.execute({ action: "validate", spec });
    const parsed = JSON.parse(r);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.some((e: string) => e.includes("paths"))).toBe(true);
  });

  it("/ 로 시작하지 않는 경로 → error 포함", async () => {
    const spec = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "X", version: "1" },
      paths: { "no-slash": { get: { responses: { "200": {} } } } },
    });
    const r = await tool.execute({ action: "validate", spec });
    const parsed = JSON.parse(r);
    expect(parsed.errors.some((e: string) => e.includes("start with /"))).toBe(true);
  });

  it("responses 없는 오퍼레이션 → error 포함", async () => {
    const spec = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "X", version: "1" },
      paths: { "/items": { post: { summary: "create" } } },
    });
    const r = await tool.execute({ action: "validate", spec });
    const parsed = JSON.parse(r);
    expect(parsed.errors.some((e: string) => e.includes("responses"))).toBe(true);
  });
});

// ══════════════════════════════════════════
// generate_client
// ══════════════════════════════════════════

describe("OpenApiTool — generate_client", () => {
  it("curl — GET 요청 생성", async () => {
    const r = await tool.execute({ action: "generate_client", spec: SIMPLE_SPEC, path: "/pets", method: "get", language: "curl" });
    expect(r).toContain("curl");
    expect(r).toContain("GET");
    expect(r).toContain("/pets");
  });

  it("curl — POST 요청 → body 포함", async () => {
    const r = await tool.execute({ action: "generate_client", spec: SIMPLE_SPEC, path: "/pets", method: "post", language: "curl" });
    expect(r).toContain("-d");
  });

  it("fetch — GET 요청 생성", async () => {
    const r = await tool.execute({ action: "generate_client", spec: SIMPLE_SPEC, path: "/pets", method: "get", language: "fetch" });
    expect(r).toContain("fetch");
    expect(r).toContain("GET");
  });

  it("fetch — PUT 요청 → body 포함", async () => {
    const r = await tool.execute({ action: "generate_client", spec: SIMPLE_SPEC, path: "/pets/{id}", method: "put", language: "fetch" });
    expect(r).toContain("body");
    expect(r).toContain("JSON.stringify");
  });

  it("python — GET 요청 생성", async () => {
    const r = await tool.execute({ action: "generate_client", spec: SIMPLE_SPEC, path: "/pets", method: "get", language: "python" });
    expect(r).toContain("requests");
    expect(r).toContain("get(");
  });

  it("python — POST 요청 → json 포함", async () => {
    const r = await tool.execute({ action: "generate_client", spec: SIMPLE_SPEC, path: "/pets", method: "post", language: "python" });
    expect(r).toContain("json=");
  });

  it("지원하지 않는 언어 → error 반환", async () => {
    const r = await tool.execute({ action: "generate_client", spec: SIMPLE_SPEC, path: "/pets", method: "get", language: "ruby" });
    const parsed = JSON.parse(r);
    expect(parsed.error).toContain("unsupported language");
  });

  it("경로 없음 → error 반환", async () => {
    const r = await tool.execute({ action: "generate_client", spec: SIMPLE_SPEC, path: "/nonexistent", method: "get", language: "curl" });
    const parsed = JSON.parse(r);
    expect(parsed.error).toContain("path not found");
  });

  it("메서드 없음 → error 반환", async () => {
    const r = await tool.execute({ action: "generate_client", spec: SIMPLE_SPEC, path: "/pets", method: "delete", language: "curl" });
    const parsed = JSON.parse(r);
    expect(parsed.error).toContain("method not found");
  });

  it("servers 없는 스펙 → 기본 URL 사용", async () => {
    const spec = JSON.stringify({
      openapi: "3.0.0",
      info: {},
      paths: { "/test": { get: { responses: {} } } },
    });
    const r = await tool.execute({ action: "generate_client", spec, path: "/test", method: "get", language: "curl" });
    expect(r).toContain("api.example.com");
  });
});

// ══════════════════════════════════════════
// to_markdown
// ══════════════════════════════════════════

describe("OpenApiTool — to_markdown", () => {
  it("마크다운 변환 → 제목 포함", async () => {
    const r = await tool.execute({ action: "to_markdown", spec: SIMPLE_SPEC });
    expect(r).toContain("# Pet API");
    expect(r).toContain("Pet store API");
    expect(r).toContain("1.0.0");
  });

  it("엔드포인트 섹션 → ## METHOD PATH 포함", async () => {
    const r = await tool.execute({ action: "to_markdown", spec: SIMPLE_SPEC });
    expect(r).toContain("## GET /pets");
    expect(r).toContain("List all pets");
  });

  it("파라미터 섹션 포함", async () => {
    const r = await tool.execute({ action: "to_markdown", spec: SIMPLE_SPEC });
    expect(r).toContain("Parameters:");
    expect(r).toContain("limit");
  });

  it("description 없는 info → 제목만 포함", async () => {
    const spec = JSON.stringify({ openapi: "3.0.0", info: { title: "Bare API" }, paths: {} });
    const r = await tool.execute({ action: "to_markdown", spec });
    expect(r).toContain("# Bare API");
  });
});

// ══════════════════════════════════════════
// unknown action
// ══════════════════════════════════════════

describe("OpenApiTool — unknown action", () => {
  it("unknown → error 반환", async () => {
    const r = await tool.execute({ action: "analyze" });
    const parsed = JSON.parse(r);
    expect(parsed.error).toContain("unknown action");
  });
});
