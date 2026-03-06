/** 모든 프론트엔드 노드 descriptor를 registry에 등록. */

import { register_frontend_node } from "../node-registry";
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
import { notify_descriptor } from "./notify";
import { aggregate_descriptor } from "./aggregate";
import { send_file_descriptor } from "./send-file";
import { error_handler_descriptor } from "./error-handler";
import { webhook_descriptor } from "./webhook";
import { hitl_descriptor } from "./hitl";
import { approval_descriptor } from "./approval";
import { form_descriptor } from "./form";
import { tool_invoke_descriptor } from "./tool-invoke";
import { gate_descriptor } from "./gate";
import { escalation_descriptor } from "./escalation";
import { cache_descriptor } from "./cache";
import { retry_descriptor } from "./retry";
import { batch_descriptor } from "./batch";
import { assert_descriptor } from "./assert";
import { git_descriptor } from "./git";
import { shell_descriptor } from "./shell";
import { web_search_descriptor } from "./web-search";
import { web_scrape_descriptor } from "./web-scrape";
import { archive_descriptor } from "./archive";
import { process_descriptor } from "./process";
import { docker_descriptor } from "./docker";
import { web_table_descriptor } from "./web-table";
import { network_descriptor } from "./network";
import { web_form_descriptor } from "./web-form";
import { system_info_descriptor } from "./system-info";
import { package_manager_descriptor } from "./package-manager";

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
  notify_descriptor,
  aggregate_descriptor,
  send_file_descriptor,
  error_handler_descriptor,
  webhook_descriptor,
  hitl_descriptor,
  approval_descriptor,
  form_descriptor,
  tool_invoke_descriptor,
  gate_descriptor,
  escalation_descriptor,
  cache_descriptor,
  retry_descriptor,
  batch_descriptor,
  assert_descriptor,
  git_descriptor,
  shell_descriptor,
  web_search_descriptor,
  web_scrape_descriptor,
  archive_descriptor,
  process_descriptor,
  docker_descriptor,
  web_table_descriptor,
  network_descriptor,
  web_form_descriptor,
  system_info_descriptor,
  package_manager_descriptor,
];

let registered = false;

export function register_all_frontend_nodes(): void {
  if (registered) return;
  registered = true;
  for (const desc of ALL_DESCRIPTORS) {
    if (!desc.category) desc.category = "advanced";
    register_frontend_node(desc);
  }
}
