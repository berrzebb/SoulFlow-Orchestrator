/**
 * NodeDescriptor — 노드 메타데이터 인터페이스.
 * 백엔드(NodeHandler)와 프론트엔드(FrontendNodeDescriptor) 공통 기반.
 */

import type { OutputField } from "./workflow-node.types.js";

export type NodeShape = "rect" | "diamond";

export interface NodeDescriptor {
  node_type: string;
  icon: string;
  color: string;
  shape: NodeShape;
  output_schema: OutputField[];
  input_schema: OutputField[];
  /** 새 노드 생성 시 기본값 (node_id, title 제외). */
  create_default: () => Record<string, unknown>;
}
