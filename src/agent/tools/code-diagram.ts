/** CodeDiagram 도구 — 소스 코드 분석 → Mermaid 다이어그램 생성. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

// ── 파싱 결과 타입 ─────────────────────────────────

interface ParsedClass {
  name: string;
  kind: "class" | "interface" | "type" | "enum";
  is_abstract: boolean;
  extends_?: string;
  implements_?: string[];
  properties: { name: string; type: string; access: string; is_static: boolean; is_readonly: boolean }[];
  methods: { name: string; params: string; return_type: string; access: string; is_static: boolean; is_async: boolean }[];
}

interface ParsedImport {
  source: string;
  specifiers: string[];
  is_type_only: boolean;
}

interface FlowNode {
  id: string;
  label: string;
  shape: "rect" | "diamond" | "stadium" | "circle";
}

interface FlowEdge {
  from: string;
  to: string;
  label?: string;
}

// ── Regex 패턴 ──────────────────────────────────────

const RE_CLASS = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+([\w.]+))?(?:\s+implements\s+([\w,\s.]+))?\s*\{/g;
const RE_INTERFACE = /(?:export\s+)?interface\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+([\w,\s.<>]+))?\s*\{/g;
const RE_TYPE_OBJ = /(?:export\s+)?type\s+(\w+)(?:<[^>]*>)?\s*=\s*\{/g;
const RE_ENUM = /(?:export\s+)?(?:const\s+)?enum\s+(\w+)\s*\{/g;
const RE_IMPORT = /import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+)(?:\s*,\s*\{([^}]+)\})?)\s+from\s+["']([^"']+)["']/g;
const RE_REQUIRE = /(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\s*\(\s*["']([^"']+)["']\s*\)/g;
const RE_FUNCTION = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{/g;
const RE_ARROW_FN = /(?:export\s+)?(?:const|let)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/g;

export class CodeDiagramTool extends Tool {
  readonly name = "code_diagram";
  readonly category = "diagram" as const;
  readonly description =
    "Analyze source code and generate Mermaid diagrams: class_diagram, sequence_diagram, flowchart, dependency_graph, er_diagram, call_graph, component_diagram.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["class_diagram", "sequence_diagram", "flowchart", "dependency_graph", "er_diagram", "call_graph", "component_diagram"],
        description: "Diagram type to generate",
      },
      source: { type: "string", description: "Source code text (TS/JS)" },
      sources: { type: "string", description: "JSON array of {path, code} for multi-file analysis" },
      actors: { type: "string", description: "JSON array of actor names (sequence_diagram)" },
      messages: { type: "string", description: "JSON array of {from, to, text, type?} (sequence_diagram)" },
      function_name: { type: "string", description: "Target function name (flowchart, call_graph)" },
      direction: { type: "string", enum: ["TB", "LR", "BT", "RL"], description: "Graph direction (default: TB)" },
      show_private: { type: "boolean", description: "Include private members (default: false)" },
      group_by_folder: { type: "boolean", description: "Group modules by folder (dependency_graph)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "class_diagram");

    switch (action) {
      case "class_diagram":
        return this.gen_class_diagram(params);
      case "sequence_diagram":
        return this.gen_sequence_diagram(params);
      case "flowchart":
        return this.gen_flowchart(params);
      case "dependency_graph":
        return this.gen_dependency_graph(params);
      case "er_diagram":
        return this.gen_er_diagram(params);
      case "call_graph":
        return this.gen_call_graph(params);
      case "component_diagram":
        return this.gen_component_diagram(params);
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  // ── Class Diagram ───────────────────────────────────

  private gen_class_diagram(params: Record<string, unknown>): string {
    const source = String(params.source || "");
    const show_private = params.show_private === true;
    const classes = this.parse_classes(source);

    if (classes.length === 0) return JSON.stringify({ error: "no classes/interfaces found in source" });

    const lines: string[] = ["classDiagram"];
    const direction = String(params.direction || "TB");
    if (direction !== "TB") lines[0] = `classDiagram`;

    for (const cls of classes) {
      // 클래스 정의
      if (cls.kind === "interface") lines.push(`  class ${cls.name} {\n    <<interface>>`);
      else if (cls.kind === "enum") lines.push(`  class ${cls.name} {\n    <<enumeration>>`);
      else if (cls.is_abstract) lines.push(`  class ${cls.name} {\n    <<abstract>>`);
      else lines.push(`  class ${cls.name} {`);

      // 프로퍼티
      for (const p of cls.properties) {
        if (!show_private && p.access === "private") continue;
        const prefix = p.access === "private" ? "-" : p.access === "protected" ? "#" : "+";
        const static_ = p.is_static ? "$ " : "";
        lines.push(`    ${prefix}${static_}${p.name}: ${this.sanitize_type(p.type)}`);
      }

      // 메서드
      for (const m of cls.methods) {
        if (!show_private && m.access === "private") continue;
        const prefix = m.access === "private" ? "-" : m.access === "protected" ? "#" : "+";
        const static_ = m.is_static ? "$ " : "";
        const async_ = m.is_async ? "async " : "";
        const ret = m.return_type ? `: ${this.sanitize_type(m.return_type)}` : "";
        lines.push(`    ${prefix}${static_}${async_}${m.name}(${this.sanitize_params(m.params)})${ret}`);
      }
      lines.push("  }");

      // 관계
      if (cls.extends_) {
        const parent = cls.extends_.split(".").pop()!;
        if (cls.kind === "interface") lines.push(`  ${parent} <|.. ${cls.name}`);
        else lines.push(`  ${parent} <|-- ${cls.name}`);
      }
      if (cls.implements_) {
        for (const iface of cls.implements_) {
          lines.push(`  ${iface.trim()} <|.. ${cls.name}`);
        }
      }
    }

    const diagram = lines.join("\n");
    return JSON.stringify({
      format: "mermaid",
      diagram_type: "classDiagram",
      class_count: classes.length,
      diagram,
    });
  }

  // ── Sequence Diagram ────────────────────────────────

  private gen_sequence_diagram(params: Record<string, unknown>): string {
    let actors: string[];
    let messages: { from: string; to: string; text: string; type?: string }[];

    try {
      actors = JSON.parse(String(params.actors || "[]"));
    } catch {
      return JSON.stringify({ error: "invalid actors JSON" });
    }
    try {
      messages = JSON.parse(String(params.messages || "[]"));
    } catch {
      return JSON.stringify({ error: "invalid messages JSON" });
    }

    if (messages.length === 0) {
      // 소스 코드에서 추출 시도
      const source = String(params.source || "");
      if (source) return this.gen_sequence_from_code(source);
      return JSON.stringify({ error: "messages or source required" });
    }

    const lines: string[] = ["sequenceDiagram"];

    // 액터 선언
    const seen_actors = new Set<string>();
    for (const a of actors) {
      if (!seen_actors.has(a)) {
        lines.push(`  participant ${this.safe_id(a)}`);
        seen_actors.add(a);
      }
    }
    // 메시지에서 누락된 액터 추가
    for (const m of messages) {
      for (const name of [m.from, m.to]) {
        if (!seen_actors.has(name)) {
          lines.push(`  participant ${this.safe_id(name)}`);
          seen_actors.add(name);
        }
      }
    }

    // 메시지
    for (const m of messages) {
      const arrow = this.sequence_arrow(m.type);
      lines.push(`  ${this.safe_id(m.from)}${arrow}${this.safe_id(m.to)}: ${this.escape_mermaid(m.text)}`);
    }

    return JSON.stringify({
      format: "mermaid",
      diagram_type: "sequenceDiagram",
      actor_count: seen_actors.size,
      message_count: messages.length,
      diagram: lines.join("\n"),
    });
  }

  private gen_sequence_from_code(source: string): string {
    // 클래스 메서드 호출 패턴: this.xxx(), obj.method() 추적
    const classes = this.parse_classes(source);
    if (classes.length === 0) return JSON.stringify({ error: "no classes found for sequence extraction" });

    const lines: string[] = ["sequenceDiagram"];
    const actors = new Set<string>();

    for (const cls of classes) {
      actors.add(cls.name);
      lines.push(`  participant ${cls.name}`);
    }

    // 메서드 본문에서 다른 클래스 호출 탐지 (간이 분석)
    const call_re = /(\w+)\s*\.\s*(\w+)\s*\(/g;
    let m: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((m = call_re.exec(source)) !== null) {
      const [, obj, method] = m;
      if (obj === "this" || obj === "console" || obj === "Math" || obj === "JSON" || obj === "Object" || obj === "Array") continue;
      const key = `${obj}.${method}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!actors.has(obj)) {
        actors.add(obj);
        lines.splice(1, 0, `  participant ${obj}`);
      }
      lines.push(`  Client->>${obj}: ${method}()`);
    }

    if (seen.size === 0) return JSON.stringify({ error: "no inter-object calls detected" });

    return JSON.stringify({
      format: "mermaid",
      diagram_type: "sequenceDiagram",
      actor_count: actors.size,
      diagram: lines.join("\n"),
    });
  }

  // ── Flowchart ───────────────────────────────────────

  private gen_flowchart(params: Record<string, unknown>): string {
    const source = String(params.source || "");
    const fn_name = String(params.function_name || "");
    const direction = String(params.direction || "TB");

    const fn_source = fn_name ? this.extract_function(source, fn_name) : source;
    if (!fn_source) return JSON.stringify({ error: fn_name ? `function '${fn_name}' not found` : "source required" });

    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];
    let node_id = 0;

    const new_node = (label: string, shape: FlowNode["shape"] = "rect"): string => {
      const id = `N${node_id++}`;
      nodes.push({ id, label: this.escape_mermaid(label), shape });
      return id;
    };

    const start = new_node("Start", "stadium");
    const statements = this.split_statements(fn_source);
    let prev = start;

    for (const stmt of statements) {
      const trimmed = stmt.trim();
      if (!trimmed || trimmed === "{" || trimmed === "}") continue;

      if (trimmed.startsWith("if ") || trimmed.startsWith("if(")) {
        const cond = this.extract_condition(trimmed);
        const cond_id = new_node(cond, "diamond");
        edges.push({ from: prev, to: cond_id });
        const yes_id = new_node("true branch", "rect");
        const no_id = new_node("false branch", "rect");
        edges.push({ from: cond_id, to: yes_id, label: "Yes" });
        edges.push({ from: cond_id, to: no_id, label: "No" });
        const merge = new_node("merge", "circle");
        edges.push({ from: yes_id, to: merge });
        edges.push({ from: no_id, to: merge });
        prev = merge;
      } else if (trimmed.startsWith("for ") || trimmed.startsWith("for(") || trimmed.startsWith("while ") || trimmed.startsWith("while(")) {
        const cond = this.extract_condition(trimmed);
        const loop_id = new_node(`Loop: ${cond}`, "diamond");
        edges.push({ from: prev, to: loop_id });
        const body = new_node("loop body", "rect");
        edges.push({ from: loop_id, to: body, label: "iterate" });
        edges.push({ from: body, to: loop_id, label: "next" });
        const exit = new_node("loop end", "circle");
        edges.push({ from: loop_id, to: exit, label: "done" });
        prev = exit;
      } else if (trimmed.startsWith("switch ") || trimmed.startsWith("switch(")) {
        const expr = this.extract_condition(trimmed);
        const sw_id = new_node(`Switch: ${expr}`, "diamond");
        edges.push({ from: prev, to: sw_id });
        const cases = this.extract_switch_cases(trimmed, fn_source);
        const merge = new_node("switch end", "circle");
        for (const c of cases) {
          const case_id = new_node(`case ${c}`, "rect");
          edges.push({ from: sw_id, to: case_id, label: c });
          edges.push({ from: case_id, to: merge });
        }
        prev = merge;
      } else if (trimmed.startsWith("return ") || trimmed === "return") {
        const ret_id = new_node(trimmed.length > 50 ? "return ..." : trimmed, "stadium");
        edges.push({ from: prev, to: ret_id });
        prev = ret_id;
      } else if (trimmed.startsWith("try ") || trimmed.startsWith("try{")) {
        const try_id = new_node("try", "rect");
        edges.push({ from: prev, to: try_id });
        const catch_id = new_node("catch", "rect");
        edges.push({ from: try_id, to: catch_id, label: "error" });
        const cont = new_node("continue", "circle");
        edges.push({ from: try_id, to: cont, label: "success" });
        edges.push({ from: catch_id, to: cont });
        prev = cont;
      } else if (trimmed.startsWith("throw ")) {
        const throw_id = new_node("throw error", "stadium");
        edges.push({ from: prev, to: throw_id });
        prev = throw_id;
      } else if (trimmed.startsWith("await ") || trimmed.includes("await ")) {
        const label = trimmed.length > 60 ? trimmed.slice(0, 57) + "..." : trimmed;
        const await_id = new_node(label, "rect");
        edges.push({ from: prev, to: await_id });
        prev = await_id;
      } else {
        // 일반 문장 — 연속 문장은 하나로 묶음
        const label = trimmed.length > 60 ? trimmed.slice(0, 57) + "..." : trimmed;
        const stmt_id = new_node(label, "rect");
        edges.push({ from: prev, to: stmt_id });
        prev = stmt_id;
      }
    }

    const end = new_node("End", "stadium");
    edges.push({ from: prev, to: end });

    // Mermaid 생성
    const lines: string[] = [`flowchart ${direction}`];
    for (const n of nodes) {
      const shape_open = n.shape === "diamond" ? "{" : n.shape === "stadium" ? "([" : n.shape === "circle" ? "((" : "[";
      const shape_close = n.shape === "diamond" ? "}" : n.shape === "stadium" ? "])" : n.shape === "circle" ? "))" : "]";
      lines.push(`  ${n.id}${shape_open}"${n.label}"${shape_close}`);
    }
    for (const e of edges) {
      const label_part = e.label ? `|"${e.label}"|` : "";
      lines.push(`  ${e.from} -->${label_part} ${e.to}`);
    }

    return JSON.stringify({
      format: "mermaid",
      diagram_type: "flowchart",
      node_count: nodes.length,
      edge_count: edges.length,
      diagram: lines.join("\n"),
    });
  }

  // ── Dependency Graph ────────────────────────────────

  private gen_dependency_graph(params: Record<string, unknown>): string {
    const direction = String(params.direction || "LR");
    const group_by_folder = params.group_by_folder === true;

    let files: { path: string; code: string }[];
    if (params.sources) {
      try {
        files = JSON.parse(String(params.sources));
      } catch {
        return JSON.stringify({ error: "invalid sources JSON" });
      }
    } else if (params.source) {
      files = [{ path: "main", code: String(params.source) }];
    } else {
      return JSON.stringify({ error: "source or sources required" });
    }

    const lines: string[] = [`graph ${direction}`];
    const all_modules = new Set<string>();
    const edges_set = new Set<string>();
    const folder_modules = new Map<string, Set<string>>();

    for (const file of files) {
      const module_name = this.path_to_module(file.path);
      all_modules.add(module_name);

      if (group_by_folder) {
        const folder = file.path.includes("/") ? file.path.split("/").slice(0, -1).join("/") : ".";
        if (!folder_modules.has(folder)) folder_modules.set(folder, new Set());
        folder_modules.get(folder)!.add(module_name);
      }

      const imports = this.parse_imports(file.code);
      for (const imp of imports) {
        if (imp.source.startsWith(".")) {
          const target = this.resolve_relative(file.path, imp.source);
          all_modules.add(target);
          const edge_key = `${module_name}-->${target}`;
          if (!edges_set.has(edge_key)) {
            edges_set.add(edge_key);
            const style = imp.is_type_only ? "-.->" : "-->";
            lines.push(`  ${this.safe_id(module_name)}${style}${this.safe_id(target)}`);
          }
        } else {
          // 외부 패키지
          const pkg = imp.source.startsWith("@") ? imp.source.split("/").slice(0, 2).join("/") : imp.source.split("/")[0];
          const pkg_id = `pkg_${this.safe_id(pkg)}`;
          all_modules.add(pkg_id);
          const edge_key = `${module_name}-->${pkg_id}`;
          if (!edges_set.has(edge_key)) {
            edges_set.add(edge_key);
            lines.push(`  ${this.safe_id(module_name)}-->${pkg_id}["${pkg} (external)"]`);
          }
        }
      }
    }

    // 폴더 그룹핑
    if (group_by_folder && folder_modules.size > 1) {
      const grouped_lines: string[] = [`graph ${direction}`];
      let sub_id = 0;
      for (const [folder, modules] of folder_modules) {
        grouped_lines.push(`  subgraph sub${sub_id++}["${folder}"]`);
        for (const mod of modules) {
          grouped_lines.push(`    ${this.safe_id(mod)}["${mod}"]`);
        }
        grouped_lines.push("  end");
      }
      // 엣지 추가
      for (const line of lines.slice(1)) {
        if (line.includes("-->") || line.includes("-.->")) grouped_lines.push(line);
      }
      return JSON.stringify({
        format: "mermaid",
        diagram_type: "dependency_graph",
        module_count: all_modules.size,
        edge_count: edges_set.size,
        diagram: grouped_lines.join("\n"),
      });
    }

    // 모듈 노드 선언
    const node_lines: string[] = [`graph ${direction}`];
    for (const mod of all_modules) {
      if (mod.startsWith("pkg_")) continue; // 외부 패키지는 엣지에서 이미 선언
      node_lines.push(`  ${this.safe_id(mod)}["${mod}"]`);
    }
    node_lines.push(...lines.slice(1));

    return JSON.stringify({
      format: "mermaid",
      diagram_type: "dependency_graph",
      module_count: all_modules.size,
      edge_count: edges_set.size,
      diagram: node_lines.join("\n"),
    });
  }

  // ── ER Diagram ──────────────────────────────────────

  private gen_er_diagram(params: Record<string, unknown>): string {
    const source = String(params.source || "");
    const classes = this.parse_classes(source);
    const type_names = new Set(classes.map((c) => c.name));

    if (classes.length === 0) return JSON.stringify({ error: "no interfaces/types found" });

    const lines: string[] = ["erDiagram"];
    const relationships = new Set<string>();

    for (const cls of classes) {
      // 엔티티 정의
      lines.push(`  ${cls.name} {`);
      for (const p of cls.properties) {
        const base_type = this.base_type_name(p.type);
        const is_pk = p.name === "id" || p.name.endsWith("_id");
        const constraint = is_pk ? " PK" : "";
        lines.push(`    ${this.er_type(p.type)} ${p.name}${constraint}`);

        // 관계 탐지
        if (type_names.has(base_type) && base_type !== cls.name) {
          const is_array = p.type.includes("[]") || p.type.includes("Array<");
          const rel_key = [cls.name, base_type].sort().join(":");
          if (!relationships.has(rel_key)) {
            relationships.add(rel_key);
            if (is_array) {
              lines.push("");  // 관계는 엔티티 블록 밖에서
              relationships.add(`  ${cls.name} ||--o{ ${base_type} : "has many"`);
            } else {
              relationships.add(`  ${cls.name} ||--o| ${base_type} : "has one"`);
            }
          }
        }
      }
      lines.push("  }");
    }

    // 관계 추가
    for (const rel of relationships) {
      if (rel.includes("||--")) lines.push(rel);
    }

    // extends 관계
    for (const cls of classes) {
      if (cls.extends_ && type_names.has(cls.extends_)) {
        lines.push(`  ${cls.extends_} ||--|| ${cls.name} : "extends"`);
      }
    }

    return JSON.stringify({
      format: "mermaid",
      diagram_type: "erDiagram",
      entity_count: classes.length,
      relationship_count: relationships.size,
      diagram: lines.join("\n"),
    });
  }

  // ── Call Graph ──────────────────────────────────────

  private gen_call_graph(params: Record<string, unknown>): string {
    const source = String(params.source || "");
    const direction = String(params.direction || "LR");
    const target = String(params.function_name || "");

    // 모든 함수 선언 수집
    const declared = new Set<string>();
    let m: RegExpExecArray | null;

    RE_FUNCTION.lastIndex = 0;
    while ((m = RE_FUNCTION.exec(source)) !== null) declared.add(m[1]);
    RE_ARROW_FN.lastIndex = 0;
    while ((m = RE_ARROW_FN.exec(source)) !== null) declared.add(m[1]);

    // 클래스 메서드도 포함
    const classes = this.parse_classes(source);
    for (const cls of classes) {
      for (const meth of cls.methods) {
        declared.add(`${cls.name}.${meth.name}`);
      }
    }

    if (declared.size === 0) return JSON.stringify({ error: "no functions found" });

    // 함수별 호출 관계 분석
    const edges = new Set<string>();
    const lines: string[] = [`graph ${direction}`];

    for (const fn_name of declared) {
      const simple = fn_name.includes(".") ? fn_name : fn_name;
      const fn_body = this.extract_function(source, fn_name.split(".").pop()!);
      if (!fn_body) continue;

      // 본문에서 다른 선언된 함수 호출 탐지
      for (const callee of declared) {
        if (callee === fn_name) continue;
        const callee_short = callee.split(".").pop()!;
        const call_pattern = new RegExp(`\\b${this.escape_regex(callee_short)}\\s*\\(`, "g");
        if (call_pattern.test(fn_body)) {
          const edge_key = `${simple}-->${callee}`;
          if (!edges.has(edge_key)) {
            edges.add(edge_key);
          }
        }
      }
    }

    // 타겟 함수가 지정되면 관련 엣지만 필터
    const relevant_edges = target
      ? [...edges].filter((e) => e.includes(target))
      : [...edges];

    // 노드 수집
    const nodes = new Set<string>();
    for (const e of relevant_edges) {
      const [from, to] = e.split("-->");
      nodes.add(from);
      nodes.add(to);
    }

    for (const n of nodes) {
      lines.push(`  ${this.safe_id(n)}["${n}"]`);
    }
    for (const e of relevant_edges) {
      const [from, to] = e.split("-->");
      lines.push(`  ${this.safe_id(from)} --> ${this.safe_id(to)}`);
    }

    return JSON.stringify({
      format: "mermaid",
      diagram_type: "call_graph",
      function_count: nodes.size,
      edge_count: relevant_edges.length,
      diagram: lines.join("\n"),
    });
  }

  // ── Component Diagram ───────────────────────────────

  private gen_component_diagram(params: Record<string, unknown>): string {
    const direction = String(params.direction || "TB");

    let files: { path: string; code: string }[];
    if (params.sources) {
      try {
        files = JSON.parse(String(params.sources));
      } catch {
        return JSON.stringify({ error: "invalid sources JSON" });
      }
    } else {
      return JSON.stringify({ error: "sources required (JSON array of {path, code})" });
    }

    // 디렉토리별 그룹핑
    const folders = new Map<string, { files: string[]; exports: Set<string>; imports: Set<string> }>();

    for (const file of files) {
      const parts = file.path.split("/");
      const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
      if (!folders.has(folder)) folders.set(folder, { files: [], exports: new Set(), imports: new Set() });
      const group = folders.get(folder)!;
      group.files.push(parts[parts.length - 1]);

      // export 수집
      const export_re = /export\s+(?:class|interface|function|const|type|enum)\s+(\w+)/g;
      let m: RegExpExecArray | null;
      while ((m = export_re.exec(file.code)) !== null) group.exports.add(m[1]);

      // import 수집 (상대 경로에서 폴더 추출)
      const imports = this.parse_imports(file.code);
      for (const imp of imports) {
        if (imp.source.startsWith(".")) {
          const target_folder = this.resolve_folder(file.path, imp.source);
          if (target_folder !== folder) group.imports.add(target_folder);
        }
      }
    }

    const lines: string[] = [`graph ${direction}`];
    let sub_id = 0;

    for (const [folder, group] of folders) {
      const id = this.safe_id(folder);
      lines.push(`  subgraph ${id}_sub["${folder}"]`);
      lines.push(`    ${id}_info["${group.files.length} files, ${group.exports.size} exports"]`);
      lines.push("  end");
      sub_id++;
    }

    // 폴더 간 의존성 엣지
    const edge_set = new Set<string>();
    for (const [folder, group] of folders) {
      for (const dep of group.imports) {
        if (folders.has(dep)) {
          const key = `${folder}-->${dep}`;
          if (!edge_set.has(key)) {
            edge_set.add(key);
            lines.push(`  ${this.safe_id(folder)}_info --> ${this.safe_id(dep)}_info`);
          }
        }
      }
    }

    return JSON.stringify({
      format: "mermaid",
      diagram_type: "component_diagram",
      component_count: folders.size,
      edge_count: edge_set.size,
      diagram: lines.join("\n"),
    });
  }

  // ── 파서 헬퍼 ──────────────────────────────────────

  private parse_classes(source: string): ParsedClass[] {
    const classes: ParsedClass[] = [];

    // 클래스
    RE_CLASS.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RE_CLASS.exec(source)) !== null) {
      const body = this.extract_block(source, m.index + m[0].length - 1);
      const is_abstract = m[0].includes("abstract ");
      classes.push({
        name: m[1],
        kind: "class",
        is_abstract,
        extends_: m[2] || undefined,
        implements_: m[3] ? m[3].split(",").map((s) => s.trim()) : undefined,
        properties: this.parse_properties(body),
        methods: this.parse_methods(body),
      });
    }

    // 인터페이스
    RE_INTERFACE.lastIndex = 0;
    while ((m = RE_INTERFACE.exec(source)) !== null) {
      const body = this.extract_block(source, m.index + m[0].length - 1);
      classes.push({
        name: m[1],
        kind: "interface",
        is_abstract: false,
        extends_: m[2]?.split(",")[0]?.trim() || undefined,
        implements_: undefined,
        properties: this.parse_properties(body),
        methods: this.parse_methods(body),
      });
    }

    // type = { ... }
    RE_TYPE_OBJ.lastIndex = 0;
    while ((m = RE_TYPE_OBJ.exec(source)) !== null) {
      const body = this.extract_block(source, m.index + m[0].length - 1);
      classes.push({
        name: m[1],
        kind: "type",
        is_abstract: false,
        properties: this.parse_properties(body),
        methods: [],
      });
    }

    // enum
    RE_ENUM.lastIndex = 0;
    while ((m = RE_ENUM.exec(source)) !== null) {
      const body = this.extract_block(source, m.index + m[0].length - 1);
      const members = body.split(",").map((s) => s.trim().split("=")[0].trim()).filter(Boolean);
      classes.push({
        name: m[1],
        kind: "enum",
        is_abstract: false,
        properties: members.map((name) => ({ name, type: "string", access: "public", is_static: false, is_readonly: true })),
        methods: [],
      });
    }

    return classes;
  }

  private parse_properties(body: string): ParsedClass["properties"] {
    const props: ParsedClass["properties"] = [];
    const re = /(?:^|\n)\s*(?:(private|protected|public)\s+)?(?:(static)\s+)?(?:(readonly)\s+)?(\w+)\s*[?]?\s*:\s*([^;{\n]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      // 메서드가 아닌 것만 (괄호 없음)
      if (m[4] && !m[5].includes("(")) {
        props.push({
          name: m[4],
          type: m[5].trim(),
          access: m[1] || "public",
          is_static: !!m[2],
          is_readonly: !!m[3],
        });
      }
    }
    return props;
  }

  private parse_methods(body: string): ParsedClass["methods"] {
    const methods: ParsedClass["methods"] = [];
    const re = /(?:^|\n)\s*(?:(private|protected|public)\s+)?(?:(static)\s+)?(?:(async)\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{;\n]+))?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      if (m[4] === "if" || m[4] === "for" || m[4] === "while" || m[4] === "switch" || m[4] === "catch") continue;
      methods.push({
        name: m[4],
        params: m[5].trim(),
        return_type: m[6]?.trim() || "",
        access: m[1] || "public",
        is_static: !!m[2],
        is_async: !!m[3],
      });
    }
    return methods;
  }

  private parse_imports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    RE_IMPORT.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RE_IMPORT.exec(source)) !== null) {
      const is_type_only = m[0].includes("import type ");
      const specifiers: string[] = [];
      if (m[1]) specifiers.push(...m[1].split(",").map((s) => s.trim()).filter(Boolean));
      if (m[2]) specifiers.push(m[2]);
      if (m[3]) specifiers.push(...m[3].split(",").map((s) => s.trim()).filter(Boolean));
      imports.push({ source: m[4], specifiers, is_type_only });
    }
    RE_REQUIRE.lastIndex = 0;
    while ((m = RE_REQUIRE.exec(source)) !== null) {
      const specifiers: string[] = [];
      if (m[1]) specifiers.push(...m[1].split(",").map((s) => s.trim()).filter(Boolean));
      if (m[2]) specifiers.push(m[2]);
      imports.push({ source: m[3], specifiers, is_type_only: false });
    }
    return imports;
  }

  private extract_block(source: string, open_brace_pos: number): string {
    let depth = 0;
    let start = open_brace_pos;
    for (let i = open_brace_pos; i < source.length; i++) {
      if (source[i] === "{") { depth++; if (depth === 1) start = i + 1; }
      if (source[i] === "}") { depth--; if (depth === 0) return source.slice(start, i); }
    }
    return source.slice(start);
  }

  private extract_function(source: string, name: string): string | null {
    const patterns = [
      new RegExp(`(?:async\\s+)?function\\s+${this.escape_regex(name)}\\s*\\([^)]*\\)[^{]*\\{`),
      new RegExp(`(?:async\\s+)?${this.escape_regex(name)}\\s*\\([^)]*\\)[^{]*\\{`),
    ];
    for (const re of patterns) {
      const m = re.exec(source);
      if (m) {
        const brace_pos = source.indexOf("{", m.index + m[0].length - 1);
        if (brace_pos >= 0) return this.extract_block(source, brace_pos);
      }
    }
    return null;
  }

  private split_statements(fn_body: string): string[] {
    // 간이 문장 분리 — 세미콜론/중괄호/줄바꿈 기준
    return fn_body.split(/[;\n]/).map((s) => s.trim()).filter((s) => s.length > 0);
  }

  private extract_condition(stmt: string): string {
    const m = stmt.match(/(?:if|for|while|switch)\s*\((.+)\)\s*\{?/);
    if (m) {
      const cond = m[1].trim();
      return cond.length > 40 ? cond.slice(0, 37) + "..." : cond;
    }
    return stmt.slice(0, 40);
  }

  private extract_switch_cases(stmt: string, full_source: string): string[] {
    const cases: string[] = [];
    const case_re = /case\s+([^:]+):/g;
    let m: RegExpExecArray | null;
    while ((m = case_re.exec(full_source)) !== null) {
      const label = m[1].trim();
      if (!cases.includes(label)) cases.push(label);
      if (cases.length >= 8) break;
    }
    if (full_source.includes("default:")) cases.push("default");
    return cases.length > 0 ? cases : ["case1", "case2", "default"];
  }

  // ── 유틸리티 ──────────────────────────────────────

  private safe_id(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "") || "node";
  }

  private escape_mermaid(text: string): string {
    return text.replace(/"/g, "'").replace(/[<>]/g, "").replace(/\n/g, " ");
  }

  private escape_regex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private sanitize_type(type: string): string {
    return type.replace(/[<>]/g, "~").replace(/"/g, "'").trim();
  }

  private sanitize_params(params: string): string {
    return params.replace(/[<>]/g, "~").replace(/"/g, "'").slice(0, 60);
  }

  private sequence_arrow(type?: string): string {
    switch (type) {
      case "async": return "-)";
      case "reply": case "response": return "-->>";
      case "dashed": return "-->";
      case "activate": return "->>+";
      case "deactivate": return "->>-";
      default: return "->>";
    }
  }

  private path_to_module(path: string): string {
    return path.replace(/\.(ts|js|tsx|jsx)$/, "").replace(/\/index$/, "").split("/").pop() || path;
  }

  private resolve_relative(from_path: string, import_source: string): string {
    const from_parts = from_path.split("/").slice(0, -1);
    const import_parts = import_source.replace(/\.(ts|js|tsx|jsx)$/, "").split("/");
    for (const part of import_parts) {
      if (part === ".") continue;
      if (part === "..") from_parts.pop();
      else from_parts.push(part);
    }
    const resolved = from_parts.join("/");
    return resolved.split("/").pop() || resolved;
  }

  private resolve_folder(from_path: string, import_source: string): string {
    const from_parts = from_path.split("/").slice(0, -1);
    const import_parts = import_source.split("/").slice(0, -1);
    const result = [...from_parts];
    for (const part of import_parts) {
      if (part === ".") continue;
      if (part === "..") result.pop();
      else result.push(part);
    }
    return result.join("/") || ".";
  }

  private base_type_name(type: string): string {
    return type.replace(/[\[\]<>?|&\s]/g, " ").split(" ").filter(Boolean)[0] || type;
  }

  private er_type(ts_type: string): string {
    const base = ts_type.replace(/\?$/, "").trim();
    if (base === "string") return "string";
    if (base === "number") return "int";
    if (base === "boolean") return "bool";
    if (base.includes("Date")) return "datetime";
    if (base.includes("[]") || base.includes("Array")) return "array";
    return "object";
  }
}
