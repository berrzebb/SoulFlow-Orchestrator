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
import { data_format_descriptor } from "./data-format";
import { encoding_descriptor } from "./encoding";
import { regex_descriptor } from "./regex";
import { diff_descriptor } from "./diff";
import { screenshot_descriptor } from "./screenshot";
import { database_descriptor } from "./database";
import { template_engine_descriptor } from "./template-engine";
import { validator_descriptor } from "./validator";
import { queue_descriptor } from "./queue";
import { ttl_cache_descriptor } from "./ttl-cache";
import { image_descriptor } from "./image";
import { stats_descriptor } from "./stats";
import { text_descriptor } from "./text";
import { compress_descriptor } from "./compress";
import { math_descriptor } from "./math";
import { table_descriptor } from "./table";
import { eval_descriptor } from "./eval";
import { date_calc_descriptor } from "./date-calc";
import { format_descriptor } from "./format";
import { set_ops_descriptor } from "./set-ops";
import { lookup_descriptor } from "./lookup";
import { markdown_descriptor } from "./markdown";
import { media_descriptor } from "./media";
import { hash_descriptor } from "./hash";
import { crypto_descriptor } from "./crypto";
import { jwt_descriptor } from "./jwt";
import { graphql_descriptor } from "./graphql";
import { email_descriptor } from "./email";
import { diagram_descriptor } from "./diagram";
import { memory_rw_descriptor } from "./memory-rw";
import { secret_read_descriptor } from "./secret-read";
import { kanban_trigger_descriptor } from "./kanban-trigger";
import { document_pdf_descriptor } from "./document-pdf";
import { document_docx_descriptor } from "./document-docx";
import { document_xlsx_descriptor } from "./document-xlsx";
import { document_pptx_descriptor } from "./document-pptx";
import { barcode_descriptor } from "./barcode";
import { changelog_descriptor } from "./changelog";
import { circuit_breaker_descriptor } from "./circuit_breaker";
import { code_diagram_descriptor } from "./code_diagram";
import { cookie_descriptor } from "./cookie";
import { csv_descriptor } from "./csv";
import { data_mask_descriptor } from "./data_mask";
import { duration_descriptor } from "./duration";
import { ftp_descriptor } from "./ftp";
import { graph_descriptor } from "./graph";
import { healthcheck_descriptor } from "./healthcheck";
import { html_descriptor } from "./html";
import { json_schema_descriptor } from "./json_schema";
import { ldap_descriptor } from "./ldap";
import { log_parser_descriptor } from "./log_parser";
import { matrix_descriptor } from "./matrix";
import { mqtt_descriptor } from "./mqtt";
import { openapi_descriptor } from "./openapi";
import { password_descriptor } from "./password";
import { pdf_descriptor } from "./pdf";
import { phone_descriptor } from "./phone";
import { qr_descriptor } from "./qr";
import { rate_limit_descriptor } from "./rate_limit";
import { redis_descriptor } from "./redis";
import { rss_descriptor } from "./rss";
import { s3_descriptor } from "./s3";
import { similarity_descriptor } from "./similarity";
import { sql_builder_descriptor } from "./sql_builder";
import { ssh_descriptor } from "./ssh";
import { state_machine_descriptor } from "./state_machine";
import { tokenizer_descriptor } from "./tokenizer";
import { websocket_descriptor } from "./websocket";
import { xml_descriptor } from "./xml";
import { yaml_descriptor } from "./yaml";
import { trigger_cron_descriptor, trigger_webhook_descriptor, trigger_manual_descriptor, trigger_channel_message_descriptor, trigger_kanban_event_descriptor, trigger_filesystem_watch_descriptor } from "./triggers";

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
  data_format_descriptor,
  encoding_descriptor,
  regex_descriptor,
  diff_descriptor,
  screenshot_descriptor,
  database_descriptor,
  template_engine_descriptor,
  validator_descriptor,
  queue_descriptor,
  ttl_cache_descriptor,
  image_descriptor,
  stats_descriptor,
  text_descriptor,
  compress_descriptor,
  math_descriptor,
  table_descriptor,
  eval_descriptor,
  date_calc_descriptor,
  format_descriptor,
  set_ops_descriptor,
  lookup_descriptor,
  markdown_descriptor,
  media_descriptor,
  hash_descriptor,
  crypto_descriptor,
  jwt_descriptor,
  graphql_descriptor,
  email_descriptor,
  diagram_descriptor,
  memory_rw_descriptor,
  secret_read_descriptor,
  kanban_trigger_descriptor,
  document_pdf_descriptor,
  document_docx_descriptor,
  document_xlsx_descriptor,
  document_pptx_descriptor,
  barcode_descriptor,
  changelog_descriptor,
  circuit_breaker_descriptor,
  code_diagram_descriptor,
  cookie_descriptor,
  csv_descriptor,
  data_mask_descriptor,
  duration_descriptor,
  ftp_descriptor,
  graph_descriptor,
  healthcheck_descriptor,
  html_descriptor,
  json_schema_descriptor,
  ldap_descriptor,
  log_parser_descriptor,
  matrix_descriptor,
  mqtt_descriptor,
  openapi_descriptor,
  password_descriptor,
  pdf_descriptor,
  phone_descriptor,
  qr_descriptor,
  rate_limit_descriptor,
  redis_descriptor,
  rss_descriptor,
  s3_descriptor,
  similarity_descriptor,
  sql_builder_descriptor,
  ssh_descriptor,
  state_machine_descriptor,
  tokenizer_descriptor,
  websocket_descriptor,
  xml_descriptor,
  yaml_descriptor,
  trigger_cron_descriptor,
  trigger_webhook_descriptor,
  trigger_manual_descriptor,
  trigger_channel_message_descriptor,
  trigger_kanban_event_descriptor,
  trigger_filesystem_watch_descriptor,
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
