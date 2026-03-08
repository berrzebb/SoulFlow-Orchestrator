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
import { data_format_handler } from "./data-format.js";
import { encoding_handler } from "./encoding.js";
import { regex_handler } from "./regex.js";
import { diff_handler } from "./diff.js";
import { screenshot_handler } from "./screenshot.js";
import { database_handler } from "./database.js";
import { template_engine_handler } from "./template-engine.js";
import { validator_handler } from "./validator.js";
import { queue_handler } from "./queue.js";
import { ttl_cache_handler } from "./ttl-cache.js";
import { image_handler } from "./image.js";
import { stats_handler } from "./stats.js";
import { text_handler } from "./text.js";
import { compress_handler } from "./compress.js";
import { math_handler } from "./math.js";
import { table_handler } from "./table.js";
import { eval_handler } from "./eval.js";
import { date_calc_handler } from "./date-calc.js";
import { format_handler } from "./format.js";
import { set_ops_handler } from "./set-ops.js";
import { lookup_handler } from "./lookup.js";
import { markdown_handler } from "./markdown.js";
import { media_handler } from "./media.js";
import { hash_handler } from "./hash.js";
import { crypto_handler } from "./crypto.js";
import { jwt_handler } from "./jwt.js";
import { graphql_handler } from "./graphql.js";
import { email_handler } from "./email.js";
import { diagram_handler } from "./diagram.js";
import { memory_rw_handler } from "./memory-rw.js";
import { secret_read_handler } from "./secret-read.js";
import { csv_handler } from "./csv.js";
import { websocket_handler } from "./websocket.js";
import { pdf_handler } from "./pdf.js";
import { rate_limit_handler } from "./rate-limit.js";
import { xml_handler } from "./xml.js";
import { yaml_handler } from "./yaml.js";
import { ftp_handler } from "./ftp.js";
import { ssh_handler } from "./ssh.js";
import { s3_handler } from "./s3.js";
import { html_handler } from "./html.js";
import { qr_handler } from "./qr.js";
import { mqtt_handler } from "./mqtt.js";
import { redis_handler } from "./redis.js";
import { sql_builder_handler } from "./sql-builder.js";
import { log_parser_handler } from "./log-parser.js";
import { rss_handler } from "./rss.js";
import { duration_handler } from "./duration.js";
import { ldap_handler } from "./ldap.js";
import { json_schema_handler } from "./json-schema.js";
import { openapi_handler } from "./openapi.js";
import { barcode_handler } from "./barcode.js";
import { phone_handler } from "./phone.js";
import { healthcheck_handler } from "./healthcheck.js";
import { cookie_handler } from "./cookie.js";
import { password_handler } from "./password.js";
import { changelog_handler } from "./changelog.js";
import { matrix_handler } from "./matrix.js";
import { state_machine_handler } from "./state-machine.js";
import { code_diagram_handler } from "./code-diagram.js";
import { graph_handler } from "./graph.js";
import { tokenizer_handler } from "./tokenizer.js";
import { similarity_handler } from "./similarity.js";
import { data_mask_handler } from "./data-mask.js";
import { circuit_breaker_handler } from "./circuit-breaker.js";
import { kanban_trigger_handler } from "./kanban-trigger.js";
import { document_pdf_handler } from "./document-pdf.js";
import { document_docx_handler } from "./document-docx.js";
import { document_xlsx_handler } from "./document-xlsx.js";
import { document_pptx_handler } from "./document-pptx.js";
import { document_convert_handler } from "./document-convert.js";

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
  data_format_handler,
  encoding_handler,
  regex_handler,
  diff_handler,
  screenshot_handler,
  database_handler,
  template_engine_handler,
  validator_handler,
  queue_handler,
  ttl_cache_handler,
  image_handler,
  stats_handler,
  text_handler,
  compress_handler,
  math_handler,
  table_handler,
  eval_handler,
  date_calc_handler,
  format_handler,
  set_ops_handler,
  lookup_handler,
  markdown_handler,
  media_handler,
  hash_handler,
  crypto_handler,
  jwt_handler,
  graphql_handler,
  email_handler,
  diagram_handler,
  memory_rw_handler,
  secret_read_handler,
  csv_handler,
  websocket_handler,
  pdf_handler,
  rate_limit_handler,
  xml_handler,
  yaml_handler,
  ftp_handler,
  ssh_handler,
  s3_handler,
  html_handler,
  qr_handler,
  mqtt_handler,
  redis_handler,
  sql_builder_handler,
  log_parser_handler,
  rss_handler,
  duration_handler,
  ldap_handler,
  json_schema_handler,
  openapi_handler,
  barcode_handler,
  phone_handler,
  healthcheck_handler,
  cookie_handler,
  password_handler,
  changelog_handler,
  matrix_handler,
  state_machine_handler,
  code_diagram_handler,
  graph_handler,
  tokenizer_handler,
  similarity_handler,
  data_mask_handler,
  circuit_breaker_handler,
  kanban_trigger_handler,
  document_pdf_handler,
  document_docx_handler,
  document_xlsx_handler,
  document_pptx_handler,
  document_convert_handler,
];

let registered = false;

export function register_all_nodes(): void {
  if (registered) return;
  registered = true;
  for (const handler of ALL_HANDLERS) {
    register_node(handler);
  }
}
