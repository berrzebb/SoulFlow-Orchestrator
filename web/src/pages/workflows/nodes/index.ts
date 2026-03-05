/** 모든 프론트엔드 노드 descriptor를 registry에 등록. */

import { register_frontend_node, type NodeCategory } from "../node-registry";
import { http_descriptor } from "./http";
import { code_descriptor } from "./code";
import { if_descriptor } from "./if";
import { merge_descriptor } from "./merge";
import { set_descriptor } from "./set";
import { split_descriptor } from "./split";
import { llm_descriptor } from "./llm";
import { switch_descriptor } from "./switch";
import { wait_descriptor } from "./wait";
import { template_descriptor } from "./template";
import { oauth_descriptor } from "./oauth";
import { sub_workflow_descriptor } from "./sub-workflow";
import { filter_descriptor } from "./filter";
import { loop_descriptor } from "./loop";
import { transform_descriptor } from "./transform";
import { db_descriptor } from "./db";
import { file_descriptor } from "./file";
import { analyzer_descriptor } from "./analyzer";
import { retriever_descriptor } from "./retriever";
import { ai_agent_descriptor } from "./ai-agent";
import { text_splitter_descriptor } from "./text-splitter";
import { task_descriptor } from "./task";
import { spawn_agent_descriptor } from "./spawn-agent";
import { decision_descriptor } from "./decision";
import { promise_descriptor } from "./promise";
import { embedding_descriptor } from "./embedding";
import { vector_store_descriptor } from "./vector-store";

const ALL_DESCRIPTORS = [
  http_descriptor,
  code_descriptor,
  if_descriptor,
  merge_descriptor,
  set_descriptor,
  split_descriptor,
  llm_descriptor,
  switch_descriptor,
  wait_descriptor,
  template_descriptor,
  oauth_descriptor,
  sub_workflow_descriptor,
  filter_descriptor,
  loop_descriptor,
  transform_descriptor,
  db_descriptor,
  file_descriptor,
  analyzer_descriptor,
  retriever_descriptor,
  ai_agent_descriptor,
  text_splitter_descriptor,
  task_descriptor,
  spawn_agent_descriptor,
  decision_descriptor,
  promise_descriptor,
  embedding_descriptor,
  vector_store_descriptor,
];

/** 노드 타입 → 카테고리 매핑. */
const CATEGORY_MAP: Record<string, NodeCategory> = {
  // Flow: 분기/반복/합류/대기
  if: "flow", switch: "flow", split: "flow", merge: "flow",
  loop: "flow", filter: "flow", wait: "flow",
  // Data: 데이터 변환/저장
  set: "data", template: "data", transform: "data", code: "data",
  db: "data", file: "data",
  // AI: LLM/에이전트/분석
  llm: "ai", ai_agent: "ai", spawn_agent: "ai", analyzer: "ai",
  text_splitter: "ai", embedding: "ai", vector_store: "ai", retriever: "ai",
  // Integration: 외부 연동
  http: "integration", oauth: "integration", sub_workflow: "integration",
  // Advanced
  task: "advanced", decision: "advanced", promise: "advanced",
};

let registered = false;

export function register_all_frontend_nodes(): void {
  if (registered) return;
  registered = true;
  for (const desc of ALL_DESCRIPTORS) {
    desc.category = CATEGORY_MAP[desc.node_type] || "advanced";
    register_frontend_node(desc);
  }
}
