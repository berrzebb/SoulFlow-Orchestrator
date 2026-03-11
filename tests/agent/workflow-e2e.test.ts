/**
 * 워크플로우 E2E 시나리오 테스트 — WorkflowTool 전체 흐름 시뮬레이션.
 *
 * 시나리오: 템플릿 생성 → 조회 → 실행 → 업데이트 → 내보내기 → 삭제
 * 실제 LLM 없이 mock DashboardWorkflowOps를 사용하여 도구 흐름을 검증.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { WorkflowTool } from "@src/agent/tools/workflow.ts";
import type { DashboardWorkflowOps } from "@src/dashboard/service.ts";
import type { WorkflowDefinition } from "@src/agent/phase-loop.types.ts";
import type { TemplateWithSlug } from "@src/orchestration/workflow-loader.ts";

/** 간단한 2-phase 워크플로우 정의. */
const SAMPLE_DEFINITION = {
  title: "Image Processing Pipeline",
  objective: "이미지를 다운로드하고 리사이즈 후 업로드",
  phases: [
    {
      phase_id: "download",
      title: "이미지 다운로드",
      agents: [
        {
          agent_id: "downloader",
          role: "downloader",
          label: "다운로더",
          backend: "claude_sdk",
          system_prompt: "이미지를 URL에서 다운로드합니다.",
        },
      ],
    },
    {
      phase_id: "process",
      title: "이미지 처리 + 업로드",
      agents: [
        {
          agent_id: "processor",
          role: "processor",
          label: "프로세서",
          backend: "claude_sdk",
          system_prompt: "이미지를 리사이즈하고 업로드합니다.",
        },
      ],
      depends_on: ["download"],
    },
  ],
};

/** nodes 기반 DAG 워크플로우 정의. */
const DAG_DEFINITION = {
  title: "Data ETL Pipeline",
  objective: "데이터 추출 → 변환 → 적재",
  nodes: [
    {
      node_id: "extract-1",
      node_type: "http_request",
      title: "API에서 데이터 추출",
      url: "https://api.example.com/data",
      method: "GET",
    },
    {
      node_id: "transform-1",
      node_type: "code",
      title: "데이터 변환",
      language: "javascript",
      code: "return input.map(x => x.value * 2);",
      depends_on: ["extract-1"],
    },
    {
      node_id: "load-1",
      node_type: "code",
      title: "결과 저장",
      language: "javascript",
      code: "await db.insert(input);",
      depends_on: ["transform-1"],
    },
  ],
};

/** mock workflow store — 인메모리 CRUD. */
function create_mock_ops(): DashboardWorkflowOps {
  const templates = new Map<string, TemplateWithSlug>();
  const workflows = new Map<string, { id: string; title: string; status: string; definition: WorkflowDefinition }>();
  let wf_seq = 0;

  return {
    async list() { return []; },
    async get(id) { return workflows.get(id) as any ?? null; },

    async create(input) {
      const id = `wf-test-${++wf_seq}`;
      workflows.set(id, {
        id, title: String(input.title || ""),
        status: "running",
        definition: input as any,
      });
      return { ok: true, workflow_id: id };
    },

    async cancel(id) {
      const wf = workflows.get(id);
      if (!wf) return false;
      wf.status = "cancelled";
      return true;
    },

    async get_messages() { return []; },
    async send_message() { return { ok: true }; },

    list_templates() {
      return Array.from(templates.values());
    },

    get_template(name) {
      const t = templates.get(name);
      return t ? { ...t } : null;
    },

    save_template(name, definition) {
      const slug = name.toLowerCase().replace(/[^a-z0-9가-힣\-_]/g, "-").replace(/-+/g, "-");
      templates.set(slug, { ...definition, slug });
      // 원본 이름으로도 접근 가능하게
      if (name !== slug) templates.set(name, { ...definition, slug });
      return slug;
    },

    delete_template(name) {
      return templates.delete(name);
    },

    import_template(yaml) {
      try {
        const parsed = JSON.parse(yaml);
        if (!parsed.title) return { ok: false, error: "invalid" };
        const slug = String(parsed.title).toLowerCase().replace(/\s+/g, "-");
        templates.set(slug, { ...parsed, slug });
        return { ok: true, name: slug };
      } catch { return { ok: false, error: "parse_error" }; }
    },

    export_template(name) {
      const t = templates.get(name);
      return t ? JSON.stringify(t) : null;
    },

    list_roles() { return []; },

    async resume() { return { ok: false, error: "not_supported" }; },
  };
}

describe("워크플로우 도구 전체 흐름", () => {
  let tool: WorkflowTool;
  let ops: DashboardWorkflowOps;

  const ctx = { sender_id: "planner-agent", channel: "dashboard", chat_id: "web" };

  beforeAll(() => {
    ops = create_mock_ops();
    tool = new WorkflowTool(ops);
  });

  // ──────────────────────────────────────────────────────
  // Phase 1: 워크플로우 템플릿 생성
  // ──────────────────────────────────────────────────────

  it("1-1. phase 기반 워크플로우 템플릿을 생성한다", async () => {
    const result = await tool.execute({
      action: "create",
      name: "image-pipeline",
      definition: SAMPLE_DEFINITION,
    }, ctx);

    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.action).toBe("created");
    expect(parsed.slug).toContain("image-pipeline");
  });

  it("1-2. orche_nodes 기반 DAG 워크플로우 템플릿을 생성한다", async () => {
    const result = await tool.execute({
      action: "create",
      name: "data-etl",
      definition: DAG_DEFINITION,
    }, ctx);

    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.slug).toContain("data-etl");
  });

  it("1-3. 이름 없이 생성하면 에러가 반환된다", async () => {
    const result = await tool.execute({
      action: "create",
      definition: SAMPLE_DEFINITION,
    }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain("name");
  });

  it("1-4. definition 없이 생성하면 에러가 반환된다", async () => {
    const result = await tool.execute({
      action: "create",
      name: "empty-workflow",
    }, ctx);
    expect(result).toContain("Error");
    expect(result).toContain("definition");
  });

  // ──────────────────────────────────────────────────────
  // Phase 2: 워크플로우 목록 조회 + 상세 조회
  // ──────────────────────────────────────────────────────

  it("2-1. 템플릿 목록에 생성된 워크플로우가 나타난다", async () => {
    const result = await tool.execute({ action: "list" }, ctx);
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(2);

    const titles = parsed.map((t: { title: string }) => t.title);
    expect(titles).toContain("Image Processing Pipeline");
    expect(titles).toContain("Data ETL Pipeline");
  });

  it("2-2. 특정 템플릿을 이름으로 조회한다", async () => {
    const result = await tool.execute({
      action: "get",
      name: "image-pipeline",
    }, ctx);

    const parsed = JSON.parse(result);
    expect(parsed.title).toBe("Image Processing Pipeline");
    expect(parsed.phases).toHaveLength(2);
    expect(parsed.phases[0].phase_id).toBe("download");
    expect(parsed.phases[1].phase_id).toBe("process");
  });

  it("2-3. 존재하지 않는 템플릿 조회 시 에러가 반환된다", async () => {
    const result = await tool.execute({
      action: "get",
      name: "nonexistent",
    }, ctx);
    expect(result).toContain("not found");
  });

  // ──────────────────────────────────────────────────────
  // Phase 3: 워크플로우 실행 (시뮬레이션)
  // ──────────────────────────────────────────────────────

  it("3-1. 템플릿 이름으로 워크플로우를 실행한다", async () => {
    const result = await tool.execute({
      action: "run",
      name: "image-pipeline",
    }, ctx);

    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.workflow_id).toMatch(/^wf-/);
  });

  it("3-2. 인라인 definition으로 즉시 실행한다", async () => {
    const result = await tool.execute({
      action: "run",
      definition: {
        title: "Quick Task",
        objective: "빠른 단일 작업",
        phases: [
          {
            phase_id: "exec",
            title: "실행",
            agents: [{ agent_id: "runner", role: "executor", backend: "claude_sdk", system_prompt: "작업 수행" }],
          },
        ],
      },
    }, ctx);

    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.workflow_id).toMatch(/^wf-/);
  });

  it("3-3. 변수를 오버라이드하여 실행한다", async () => {
    const result = await tool.execute({
      action: "run",
      name: "image-pipeline",
      variables: { image_url: "https://example.com/photo.jpg" },
    }, ctx);

    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
  });

  it("3-4. 존재하지 않는 템플릿 실행 시 에러가 반환된다", async () => {
    const result = await tool.execute({
      action: "run",
      name: "ghost-workflow",
    }, ctx);
    expect(result).toContain("not found");
  });

  it("3-5. name도 definition도 없으면 에러가 반환된다", async () => {
    const result = await tool.execute({ action: "run" }, ctx);
    expect(result).toContain("Error");
  });

  // ──────────────────────────────────────────────────────
  // Phase 4: 워크플로우 업데이트
  // ──────────────────────────────────────────────────────

  it("4-1. 기존 템플릿의 definition을 업데이트한다", async () => {
    const updated = {
      ...SAMPLE_DEFINITION,
      objective: "이미지를 다운로드하고 워터마크를 추가한 후 업로드",
      phases: [
        ...SAMPLE_DEFINITION.phases,
        {
          phase_id: "watermark",
          title: "워터마크 추가",
          agents: [
            {
              agent_id: "watermarker",
              role: "watermarker",
              label: "워터마커",
              backend: "claude_sdk",
              system_prompt: "이미지에 워터마크를 추가합니다.",
            },
          ],
          depends_on: ["download"],
        },
      ],
    };

    const result = await tool.execute({
      action: "update",
      name: "image-pipeline",
      definition: updated,
    }, ctx);

    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.action).toBe("updated");
  });

  it("4-2. 업데이트된 내용이 조회에 반영된다", async () => {
    const result = await tool.execute({
      action: "get",
      name: "image-pipeline",
    }, ctx);

    const parsed = JSON.parse(result);
    expect(parsed.objective).toContain("워터마크");
    expect(parsed.phases.length).toBeGreaterThanOrEqual(3);
  });

  it("4-3. 존재하지 않는 템플릿 업데이트 시 에러가 반환된다", async () => {
    const result = await tool.execute({
      action: "update",
      name: "nonexistent",
      definition: SAMPLE_DEFINITION,
    }, ctx);
    expect(result).toContain("not found");
  });

  // ──────────────────────────────────────────────────────
  // Phase 5: 워크플로우 내보내기
  // ──────────────────────────────────────────────────────

  it("5-1. 템플릿을 YAML/JSON으로 내보낸다", async () => {
    const result = await tool.execute({
      action: "export",
      name: "image-pipeline",
    }, ctx);

    // JSON 형태로 직렬화된 결과
    expect(result).toContain("Image Processing Pipeline");
    expect(result).toContain("download");
    expect(result).toContain("process");
  });

  it("5-2. 존재하지 않는 템플릿 내보내기 시 에러가 반환된다", async () => {
    const result = await tool.execute({
      action: "export",
      name: "ghost",
    }, ctx);
    expect(result).toContain("not found");
  });

  // ──────────────────────────────────────────────────────
  // Phase 6: 노드 카탈로그 조회
  // ──────────────────────────────────────────────────────

  it("6-1. node_types로 사용 가능한 노드 목록을 조회한다", async () => {
    const result = await tool.execute({ action: "node_types" }, ctx);
    expect(result).toContain("Available Workflow Node Types");
    expect(result).toContain("Workflow Definition");
  });

  it("6-2. 카테고리 필터로 노드를 제한할 수 있다", async () => {
    const result = await tool.execute({
      action: "node_types",
      node_categories: ["flow"],
    }, ctx);
    expect(result).toContain("Available Workflow Node Types");
  });

  // ──────────────────────────────────────────────────────
  // Phase 7: 워크플로우 삭제 + 최종 검증
  // ──────────────────────────────────────────────────────

  it("7-1. data-etl 템플릿을 삭제한다", async () => {
    const result = await tool.execute({
      action: "delete",
      name: "data-etl",
    }, ctx);

    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.action).toBe("deleted");
  });

  it("7-2. 삭제된 템플릿은 조회할 수 없다", async () => {
    const result = await tool.execute({
      action: "get",
      name: "data-etl",
    }, ctx);
    expect(result).toContain("not found");
  });

  it("7-3. image-pipeline 템플릿을 삭제한다", async () => {
    const result = await tool.execute({
      action: "delete",
      name: "image-pipeline",
    }, ctx);

    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
  });

  it("7-4. 모든 템플릿 삭제 후 목록이 비어있다", async () => {
    const result = await tool.execute({ action: "list" }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────
  // Phase 8: 에러 케이스
  // ──────────────────────────────────────────────────────

  it("8-1. 지원하지 않는 action은 에러를 반환한다", async () => {
    const result = await tool.execute({ action: "invalid_action" }, ctx);
    expect(result).toContain("unsupported action");
  });

  it("8-2. action 없이 호출하면 에러를 반환한다", async () => {
    const result = await tool.execute({}, ctx);
    expect(result).toContain("unsupported action");
  });
});
