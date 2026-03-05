/** 모든 노드 핸들러를 registry에 등록. */

import { register_node } from "../node-registry.js";
import { http_handler } from "./http.js";
import { code_handler } from "./code.js";
import { if_handler } from "./if.js";
import { merge_handler } from "./merge.js";
import { set_handler } from "./set.js";
import { split_handler } from "./split.js";
import { llm_handler } from "./llm.js";
import { switch_handler } from "./switch.js";
import { wait_handler } from "./wait.js";
import { template_handler } from "./template.js";
import { oauth_handler } from "./oauth.js";
import { sub_workflow_handler } from "./sub-workflow.js";
import { filter_handler } from "./filter.js";
import { loop_handler } from "./loop.js";
import { transform_handler } from "./transform.js";
import { db_handler } from "./db.js";
import { file_handler } from "./file.js";
import { analyzer_handler } from "./analyzer.js";
import { retriever_handler } from "./retriever.js";
import { ai_agent_handler } from "./ai-agent.js";
import { text_splitter_handler } from "./text-splitter.js";
import { task_handler } from "./task.js";
import { spawn_agent_handler } from "./spawn-agent.js";
import { decision_handler } from "./decision.js";
import { promise_handler } from "./promise.js";
import { embedding_handler } from "./embedding.js";
import { vector_store_handler } from "./vector-store.js";

const ALL_HANDLERS = [
  http_handler,
  code_handler,
  if_handler,
  merge_handler,
  set_handler,
  split_handler,
  llm_handler,
  switch_handler,
  wait_handler,
  template_handler,
  oauth_handler,
  sub_workflow_handler,
  filter_handler,
  loop_handler,
  transform_handler,
  db_handler,
  file_handler,
  analyzer_handler,
  retriever_handler,
  ai_agent_handler,
  text_splitter_handler,
  task_handler,
  spawn_agent_handler,
  decision_handler,
  promise_handler,
  embedding_handler,
  vector_store_handler,
];

let registered = false;

export function register_all_nodes(): void {
  if (registered) return;
  registered = true;
  for (const handler of ALL_HANDLERS) {
    register_node(handler);
  }
}
