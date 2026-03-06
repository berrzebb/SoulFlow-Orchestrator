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
import { notify_handler } from "./notify.js";
import { aggregate_handler } from "./aggregate.js";
import { send_file_handler } from "./send-file.js";
import { error_handler_handler } from "./error-handler.js";
import { webhook_handler } from "./webhook.js";
import { hitl_handler } from "./hitl.js";
import { approval_handler } from "./approval.js";
import { form_handler } from "./form.js";
import { tool_invoke_handler } from "./tool-invoke.js";
import { gate_handler } from "./gate.js";
import { escalation_handler } from "./escalation.js";
import { cache_handler } from "./cache.js";
import { retry_handler } from "./retry.js";
import { batch_handler } from "./batch.js";
import { assert_handler } from "./assert.js";
import { git_handler } from "./git.js";
import { shell_handler } from "./shell.js";
import { web_search_handler } from "./web-search.js";
import { web_scrape_handler } from "./web-scrape.js";
import { archive_handler } from "./archive.js";
import { process_handler } from "./process.js";
import { docker_handler } from "./docker.js";
import { web_table_handler } from "./web-table.js";
import { network_handler } from "./network.js";
import { web_form_handler } from "./web-form.js";
import { system_info_handler } from "./system-info.js";
import { package_manager_handler } from "./package-manager.js";

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
  notify_handler,
  aggregate_handler,
  send_file_handler,
  error_handler_handler,
  webhook_handler,
  hitl_handler,
  approval_handler,
  form_handler,
  tool_invoke_handler,
  gate_handler,
  escalation_handler,
  cache_handler,
  retry_handler,
  batch_handler,
  assert_handler,
  git_handler,
  shell_handler,
  web_search_handler,
  web_scrape_handler,
  archive_handler,
  process_handler,
  docker_handler,
  web_table_handler,
  network_handler,
  web_form_handler,
  system_info_handler,
  package_manager_handler,
];

let registered = false;

export function register_all_nodes(): void {
  if (registered) return;
  registered = true;
  for (const handler of ALL_HANDLERS) {
    register_node(handler);
  }
}
