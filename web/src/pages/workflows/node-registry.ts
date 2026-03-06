/**
 * 프론트엔드 Node Registry.
 * 각 노드 descriptor가 메타데이터 + EditPanel을 번들링.
 * graph-editor / builder 는 registry를 조회하여 데이터 드리븐 렌더링.
 */

import type { OutputField } from "./output-schema";

export type NodeShape = "rect" | "diamond";

export type NodeCategory = "flow" | "data" | "ai" | "integration" | "interaction" | "advanced";

export const NODE_CATEGORIES: { id: NodeCategory; label: string; icon: string }[] = [
  { id: "flow", label: "Flow", icon: "⑆" },
  { id: "data", label: "Data", icon: "⛁" },
  { id: "ai", label: "AI", icon: "🤖" },
  { id: "integration", label: "I/O", icon: "↗" },
  { id: "interaction", label: "Human", icon: "🙋" },
  { id: "advanced", label: "More", icon: "⚙" },
];

export interface FrontendNodeDescriptor {
  node_type: string;
  icon: string;
  color: string;
  shape: NodeShape;
  toolbar_label: string;
  category?: NodeCategory;
  output_schema: OutputField[];
  input_schema: OutputField[];
  create_default: () => Record<string, unknown>;
  /** 노드 설정 편집 패널 (builder.tsx 모달 내부에 렌더링). */
  EditPanel: React.ComponentType<EditPanelProps>;
}

/** 노드 편집 패널에서 사용 가능한 동적 옵션 (API에서 가져온 기존 리소스 목록). */
export interface NodeOptions {
  backends?: { value: string; label: string }[];
  models?: { name: string }[];
  oauth_integrations?: { instance_id: string; label: string; service_type: string; enabled: boolean }[];
  workflow_templates?: { title: string; slug: string }[];
  channels?: { provider: string; channel_id: string; label: string; enabled: boolean }[];
  available_tools?: string[];
  tool_definitions?: Array<Record<string, unknown>>;
  available_skills?: string[];
}

export interface EditPanelProps {
  node: Record<string, unknown>;
  update: (partial: Record<string, unknown>) => void;
  t: (key: string) => string;
  /** API에서 가져온 리소스 목록. 노드 편집 시 select/dropdown 제공. */
  options?: NodeOptions;
}

// ── Registry ────────────────────────────────────────

const registry = new Map<string, FrontendNodeDescriptor>();

export function register_frontend_node(desc: FrontendNodeDescriptor): void {
  registry.set(desc.node_type, desc);
}

export function get_frontend_node(node_type: string): FrontendNodeDescriptor | undefined {
  return registry.get(node_type);
}

export function get_all_frontend_nodes(): FrontendNodeDescriptor[] {
  return [...registry.values()];
}

/** 카테고리별 그룹화된 노드 목록. */
export function get_nodes_by_category(): Map<NodeCategory, FrontendNodeDescriptor[]> {
  const map = new Map<NodeCategory, FrontendNodeDescriptor[]>();
  for (const cat of NODE_CATEGORIES) map.set(cat.id, []);
  for (const desc of registry.values()) {
    const cat = desc.category || "advanced";
    const arr = map.get(cat);
    if (arr) arr.push(desc);
    else map.set(cat, [desc]);
  }
  return map;
}
