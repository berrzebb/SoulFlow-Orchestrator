/**
 * workflow-loader.ts — 파일 I/O 기반 함수 테스트.
 * load_workflow_templates, load_workflow_template, save_workflow_template, delete_workflow_template.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  load_workflow_templates,
  load_workflow_template,
  save_workflow_template,
  delete_workflow_template,
} from "@src/orchestration/workflow-loader.js";
import type { WorkflowDefinition } from "@src/agent/phase-loop.types.js";

const SIMPLE_WF: WorkflowDefinition = {
  title: "Simple Workflow",
  objective: "Do something simple",
  phases: [
    {
      phase_id: "p1",
      title: "Phase 1",
      agents: [{ agent_id: "a1", role: "dev", label: "Dev", system_prompt: "Do work" }],
    },
  ],
};

let tmp_dir: string;

beforeEach(async () => {
  tmp_dir = await mkdtemp(join(tmpdir(), "wf-io-"));
});

afterEach(async () => {
  await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
});

// ── load_workflow_templates ──

describe("load_workflow_templates", () => {
  it("workflows 디렉토리 없으면 빈 배열", () => {
    const result = load_workflow_templates(tmp_dir);
    expect(result).toEqual([]);
  });

  it("workflows 디렉토리 있고 파일 없으면 빈 배열", async () => {
    await mkdir(join(tmp_dir, "workflows"), { recursive: true });
    expect(load_workflow_templates(tmp_dir)).toEqual([]);
  });

  it("JSON 형식의 yaml 파일 로드", async () => {
    await mkdir(join(tmp_dir, "workflows"), { recursive: true });
    const def = {
      title: "JSON WF",
      phases: [{ phase_id: "p", agents: [{ role: "a" }] }],
    };
    await writeFile(join(tmp_dir, "workflows", "json-wf.yaml"), JSON.stringify(def));

    const templates = load_workflow_templates(tmp_dir);
    expect(templates.length).toBe(1);
    expect(templates[0].title).toBe("JSON WF");
    expect(templates[0].slug).toBe("json-wf");
  });

  it("여러 파일 로드 (.yaml + .yml)", async () => {
    await mkdir(join(tmp_dir, "workflows"), { recursive: true });
    const def = (title: string) => JSON.stringify({
      title,
      phases: [{ phase_id: "p", agents: [{ role: "a" }] }],
    });
    await writeFile(join(tmp_dir, "workflows", "alpha.yaml"), def("Alpha WF"));
    await writeFile(join(tmp_dir, "workflows", "beta.yml"), def("Beta WF"));

    const templates = load_workflow_templates(tmp_dir);
    expect(templates.length).toBe(2);
    expect(templates.map((t) => t.slug).sort()).toEqual(["alpha", "beta"]);
  });

  it("title 없는 파일은 스킵", async () => {
    await mkdir(join(tmp_dir, "workflows"), { recursive: true });
    await writeFile(join(tmp_dir, "workflows", "bad.yaml"), JSON.stringify({ phases: [{ phase_id: "p", agents: [{ role: "a" }] }] }));
    await writeFile(join(tmp_dir, "workflows", "good.yaml"), JSON.stringify({
      title: "Good",
      phases: [{ phase_id: "p", agents: [{ role: "a" }] }],
    }));

    const templates = load_workflow_templates(tmp_dir);
    expect(templates.length).toBe(1);
    expect(templates[0].title).toBe("Good");
  });

  it("malformed JSON 파일은 스킵", async () => {
    await mkdir(join(tmp_dir, "workflows"), { recursive: true });
    await writeFile(join(tmp_dir, "workflows", "broken.yaml"), "{ bad json !!!");
    await writeFile(join(tmp_dir, "workflows", "ok.yaml"), JSON.stringify({
      title: "OK",
      phases: [{ phase_id: "p", agents: [{ role: "a" }] }],
    }));

    const templates = load_workflow_templates(tmp_dir);
    expect(templates.length).toBe(1);
  });

  it("aliases 필드 포함 시 templates에 반영", async () => {
    await mkdir(join(tmp_dir, "workflows"), { recursive: true });
    const def = {
      title: "WF with Aliases",
      phases: [{ phase_id: "p", agents: [{ role: "a" }] }],
      aliases: ["alias1", "alias2"],
    };
    await writeFile(join(tmp_dir, "workflows", "aliased.yaml"), JSON.stringify(def));

    const templates = load_workflow_templates(tmp_dir);
    expect(templates[0].aliases).toEqual(["alias1", "alias2"]);
  });
});

// ── load_workflow_template ──

describe("load_workflow_template", () => {
  it("workflows 디렉토리 없으면 null", () => {
    expect(load_workflow_template(tmp_dir, "my-wf")).toBeNull();
  });

  it("slug(파일명)으로 exact match", async () => {
    await mkdir(join(tmp_dir, "workflows"), { recursive: true });
    const def = { title: "Exact Match", phases: [{ phase_id: "p", agents: [{ role: "a" }] }] };
    await writeFile(join(tmp_dir, "workflows", "my-wf.yaml"), JSON.stringify(def));

    const result = load_workflow_template(tmp_dir, "my-wf");
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Exact Match");
  });

  it(".yml 확장자 지원", async () => {
    await mkdir(join(tmp_dir, "workflows"), { recursive: true });
    const def = { title: "YML WF", phases: [{ phase_id: "p", agents: [{ role: "a" }] }] };
    await writeFile(join(tmp_dir, "workflows", "test-wf.yml"), JSON.stringify(def));

    const result = load_workflow_template(tmp_dir, "test-wf");
    expect(result).not.toBeNull();
    expect(result!.title).toBe("YML WF");
  });

  it("title 부분 매칭 (case-insensitive)", async () => {
    await mkdir(join(tmp_dir, "workflows"), { recursive: true });
    const def = { title: "News Summary", phases: [{ phase_id: "p", agents: [{ role: "a" }] }] };
    await writeFile(join(tmp_dir, "workflows", "news.yaml"), JSON.stringify(def));

    const result = load_workflow_template(tmp_dir, "news summary");
    expect(result).not.toBeNull();
    expect(result!.title).toBe("News Summary");
  });

  it("alias 매칭", async () => {
    await mkdir(join(tmp_dir, "workflows"), { recursive: true });
    const def = {
      title: "Complex Workflow",
      phases: [{ phase_id: "p", agents: [{ role: "a" }] }],
      aliases: ["cw", "complex"],
    };
    await writeFile(join(tmp_dir, "workflows", "complex.yaml"), JSON.stringify(def));

    const result = load_workflow_template(tmp_dir, "cw");
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Complex Workflow");
  });

  it("매칭되는 파일 없으면 null", async () => {
    await mkdir(join(tmp_dir, "workflows"), { recursive: true });
    const def = { title: "My WF", phases: [{ phase_id: "p", agents: [{ role: "a" }] }] };
    await writeFile(join(tmp_dir, "workflows", "my-wf.yaml"), JSON.stringify(def));

    expect(load_workflow_template(tmp_dir, "nonexistent")).toBeNull();
  });
});

// ── save_workflow_template / delete_workflow_template ──

describe("save_workflow_template + delete_workflow_template", () => {
  it("저장 후 slug 반환", () => {
    const slug = save_workflow_template(tmp_dir, "My New Workflow", SIMPLE_WF);
    expect(slug).toBe("my-new-workflow");
  });

  it("저장 후 load로 읽기 가능", () => {
    save_workflow_template(tmp_dir, "Saved WF", SIMPLE_WF);
    const result = load_workflow_template(tmp_dir, "saved-wf");
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Simple Workflow");
  });

  it("delete_workflow_template: .yaml 파일 삭제 → true", () => {
    save_workflow_template(tmp_dir, "Delete Me", SIMPLE_WF);
    const ok = delete_workflow_template(tmp_dir, "delete-me");
    expect(ok).toBe(true);
    expect(load_workflow_template(tmp_dir, "delete-me")).toBeNull();
  });

  it("delete_workflow_template: 없는 파일 → false", () => {
    expect(delete_workflow_template(tmp_dir, "nonexistent")).toBe(false);
  });

  it("delete_workflow_template: workflows 디렉토리 없으면 false", () => {
    expect(delete_workflow_template(tmp_dir, "any")).toBe(false);
  });

  it("slug 변환 포함 저장 (특수문자 → 하이픈)", () => {
    const slug = save_workflow_template(tmp_dir, "My WF & More!", SIMPLE_WF);
    expect(slug).toBe("my-wf-more");
    const result = load_workflow_template(tmp_dir, "my-wf-more");
    expect(result).not.toBeNull();
  });
});
