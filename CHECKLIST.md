# 워크플로우 노드/도구 종합 체크리스트

> 이 문서는 이터레이션마다 읽고 업데이트합니다.
> 마지막 업데이트: 2026-03-10 (이터레이션 8)

## 프로젝트 루트
`d:/claude-tools/.claude/mcp-servers/slack/next/`

## 핵심 파일 위치
| 항목 | 경로 |
|------|------|
| 프론트엔드 노드 | `web/src/pages/workflows/nodes/` |
| 백엔드 노드 핸들러 | `src/agent/nodes/` |
| 백엔드 도구 | `src/agent/tools/` |
| i18n EN | `src/i18n/locales/en.json` |
| i18n KO | `src/i18n/locales/ko.json` |
| 노드 레지스트리 | `src/agent/node-registry.ts` |
| 프론트 노드 레지스트리 | `web/src/pages/workflows/node-registry.ts` |
| 워크플로우 노드 타입 | `src/agent/workflow-node.types.ts` |

---

## 노드-도구 매핑 (백엔드 기준)

| 노드 (node_type) | 백엔드 노드 파일 | 백엔드 도구 파일 | 프론트 파일 |
|-----------------|----------------|-----------------|-----------|
| aggregate | nodes/aggregate.ts | tools/aggregate.ts | nodes/aggregate.tsx |
| ai_agent | nodes/ai-agent.ts | — (직접 구현) | nodes/ai-agent.tsx |
| analyzer | nodes/analyzer.ts | tools/sentiment.ts 등 | nodes/analyzer.tsx |
| approval | nodes/approval.ts | tools/approval-notifier.ts | nodes/approval.tsx |
| archive | nodes/archive.ts | tools/archive.ts | nodes/archive.tsx |
| assert | nodes/assert.ts | — | nodes/assert.tsx |
| barcode | nodes/barcode.ts | tools/barcode.ts | nodes/barcode.tsx |
| batch | nodes/batch.ts | — (내부 순환) | nodes/batch.tsx |
| cache | nodes/cache.ts | tools/store.ts | nodes/cache.tsx |
| changelog | nodes/changelog.ts | tools/changelog.ts | nodes/changelog.tsx |
| circuit_breaker | nodes/circuit-breaker.ts | tools/circuit-breaker.ts | nodes/circuit_breaker.tsx |
| code | nodes/code.ts | tools/eval.ts | nodes/code.tsx |
| code_diagram | nodes/code-diagram.ts | tools/code-diagram.ts | nodes/code_diagram.tsx |
| compress | nodes/compress.ts | tools/compress.ts | nodes/compress.tsx |
| cookie | nodes/cookie.ts | tools/cookie.ts | nodes/cookie.tsx |
| crypto | nodes/crypto.ts | tools/crypto.ts | nodes/crypto.tsx |
| csv | nodes/csv.ts | tools/csv.ts | nodes/csv.tsx |
| data_format | nodes/data-format.ts | tools/data-format.ts | nodes/data-format.tsx |
| data_mask | nodes/data-mask.ts | tools/data-mask.ts | nodes/data_mask.tsx |
| database | nodes/database.ts | tools/database.ts | nodes/database.tsx |
| date_calc | nodes/date-calc.ts | tools/datetime.ts | nodes/date-calc.tsx |
| db | nodes/db.ts | tools/store.ts | nodes/db.tsx |
| decision | nodes/decision.ts | tools/decision-tool.ts | nodes/decision.tsx |
| diagram | nodes/diagram.ts | tools/diagram.ts | nodes/diagram.tsx |
| diff | nodes/diff.ts | tools/diff.ts | nodes/diff.tsx |
| docker | nodes/docker.ts | tools/docker.ts | nodes/docker.tsx |
| document_docx | nodes/document-docx.ts | tools/document.ts | nodes/document-docx.tsx |
| document_pdf | nodes/document-pdf.ts | tools/document.ts | nodes/document-pdf.tsx |
| document_pptx | nodes/document-pptx.ts | tools/document.ts | nodes/document-pptx.tsx |
| document_xlsx | nodes/document-xlsx.ts | tools/document.ts | nodes/document-xlsx.tsx |
| duration | nodes/duration.ts | tools/duration.ts | nodes/duration.tsx |
| email | nodes/email.ts | tools/email.ts | nodes/email.tsx |
| embedding | nodes/embedding.ts | tools/embedding.ts | nodes/embedding.tsx |
| encoding | nodes/encoding.ts | tools/encoding.ts | nodes/encoding.tsx |
| error_handler | nodes/error-handler.ts | — | nodes/error-handler.tsx |
| escalation | nodes/escalation.ts | tools/approval-notifier.ts | nodes/escalation.tsx |
| eval | nodes/eval.ts | tools/eval.ts | nodes/eval.tsx |
| file | nodes/file.ts | tools/filesystem.ts | nodes/file.tsx |
| filesystem_watch | nodes/filesystem-watch.ts | — | nodes/triggers.tsx (trigger_filesystem_watch) |
| filter | nodes/filter.ts | tools/filter.ts | nodes/filter.tsx |
| form | nodes/form.ts | — | nodes/form.tsx |
| format | nodes/format.ts | tools/format.ts | nodes/format.tsx |
| ftp | nodes/ftp.ts | tools/ftp.ts | nodes/ftp.tsx |
| gate | nodes/gate.ts | — | nodes/gate.tsx |
| git | nodes/git.ts | tools/git.ts | nodes/git.tsx |
| graph | nodes/graph.ts | tools/graph.ts | nodes/graph.tsx |
| graphql | nodes/graphql.ts | tools/graphql.ts | nodes/graphql.tsx |
| hash | nodes/hash.ts | tools/crypto.ts | nodes/hash.tsx |
| healthcheck | nodes/healthcheck.ts | tools/network.ts 등 | nodes/healthcheck.tsx |
| hitl | nodes/hitl.ts | — | nodes/hitl.tsx |
| html | nodes/html.ts | tools/web.ts | nodes/html.tsx |
| http | nodes/http.ts | — (fetch) | nodes/http.tsx |
| if | nodes/if.ts | — | nodes/if.tsx |
| image | nodes/image.ts | tools/image.ts (sharp) | nodes/image.tsx |
| json_schema | nodes/json-schema.ts | tools/validator.ts 등 | nodes/json_schema.tsx |
| jwt | nodes/jwt.ts | tools/crypto.ts 등 | nodes/jwt.tsx |
| kanban_trigger | nodes/kanban-trigger.ts | — | nodes/kanban-trigger.tsx |
| ldap | nodes/ldap.ts | tools/ldap.ts | nodes/ldap.tsx |
| llm | nodes/llm.ts | — (AI 직접 호출) | nodes/llm.tsx |
| log_parser | nodes/log-parser.ts | tools/log-parser.ts | nodes/log_parser.tsx |
| lookup | nodes/lookup.ts | — | nodes/lookup.tsx |
| loop | nodes/loop.ts | — | nodes/loop.tsx |
| markdown | nodes/markdown.ts | tools/markdown.ts | nodes/markdown.tsx |
| math | nodes/math.ts | tools/math.ts | nodes/math.tsx |
| matrix | nodes/matrix.ts | tools/matrix.ts | nodes/matrix.tsx |
| media | nodes/media.ts | tools/media.ts (sharp) | nodes/media.tsx |
| memory_rw | nodes/memory-rw.ts | — (memory 직접) | nodes/memory-rw.tsx |
| merge | nodes/merge.ts | — | nodes/merge.tsx |
| mqtt | nodes/mqtt.ts | tools/mqtt.ts | nodes/mqtt.tsx |
| network | nodes/network.ts | tools/network.ts | nodes/network.tsx |
| notify | nodes/notify.ts | tools/notification.ts 등 | nodes/notify.tsx |
| oauth | nodes/oauth.ts | tools/oauth-fetch.ts | nodes/oauth.tsx |
| openapi | nodes/openapi.ts | tools/openapi.ts | nodes/openapi.tsx |
| package_manager | nodes/package-manager.ts | tools/package-manager.ts | nodes/package-manager.tsx |
| password | nodes/password.ts | tools/password.ts | nodes/password.tsx |
| pdf | nodes/pdf.ts | tools/pdf.ts | nodes/pdf.tsx |
| phone | nodes/phone.ts | tools/phone.ts | nodes/phone.tsx |
| process | nodes/process.ts | tools/process-manager.ts | nodes/process.tsx |
| promise | nodes/promise.ts | tools/promise-tool.ts | nodes/promise.tsx |
| qr | nodes/qr.ts | tools/qr.ts | nodes/qr.tsx |
| queue | nodes/queue.ts | tools/queue.ts | nodes/queue.tsx |
| rate_limit | nodes/rate-limit.ts | tools/rate-limit.ts | nodes/rate_limit.tsx |
| redis | nodes/redis.ts | tools/redis.ts | nodes/redis.tsx |
| regex | nodes/regex.ts | tools/regex.ts | nodes/regex.tsx |
| retriever | nodes/retriever.ts | tools/retriever.ts | nodes/retriever.tsx |
| retry | nodes/retry.ts | — | nodes/retry.tsx |
| rss | nodes/rss.ts | tools/rss.ts | nodes/rss.tsx |
| s3 | nodes/s3.ts | tools/s3.ts | nodes/s3.tsx |
| screenshot | nodes/screenshot.ts | tools/screenshot.ts | nodes/screenshot.tsx |
| secret_read | nodes/secret-read.ts | tools/secret-tool.ts | nodes/secret-read.tsx |
| send_file | nodes/send-file.ts | — | nodes/send-file.tsx |
| set | nodes/set.ts | tools/set.ts | nodes/set.tsx |
| set_ops | nodes/set-ops.ts | — (set 내장) | nodes/set-ops.tsx |
| shell | nodes/shell.ts | tools/shell.ts | nodes/shell.tsx |
| similarity | nodes/similarity.ts | tools/similarity.ts | nodes/similarity.tsx |
| spawn_agent | nodes/spawn-agent.ts | tools/spawn.ts | nodes/spawn-agent.tsx |
| split | nodes/split.ts | — | nodes/split.tsx |
| sql_builder | nodes/sql-builder.ts | tools/sql-builder.ts | nodes/sql_builder.tsx |
| ssh | nodes/ssh.ts | tools/ssh.ts | nodes/ssh.tsx |
| state_machine | nodes/state-machine.ts | tools/state-machine.ts | nodes/state_machine.tsx |
| stats | nodes/stats.ts | tools/stats.ts | nodes/stats.tsx |
| sub_workflow | nodes/sub-workflow.ts | — | nodes/sub-workflow.tsx |
| switch | nodes/switch.ts | — | nodes/switch.tsx |
| system_info | nodes/system-info.ts | tools/system-info.ts | nodes/system-info.tsx |
| table | nodes/table.ts | tools/table.ts | nodes/table.tsx |
| task | nodes/task.ts | tools/task-query.ts | nodes/task.tsx |
| template | nodes/template.ts | tools/template-engine.ts | nodes/template.tsx |
| template_engine | nodes/template-engine.ts | tools/template-engine.ts | nodes/template-engine.tsx |
| text | nodes/text.ts | tools/text.ts | nodes/text.tsx |
| text_splitter | nodes/text-splitter.ts | tools/text-splitter.ts | nodes/text-splitter.tsx |
| tokenizer | nodes/tokenizer.ts | tools/tokenizer.ts | nodes/tokenizer.tsx |
| tool_invoke | nodes/tool-invoke.ts | — | nodes/tool-invoke.tsx |
| transform | nodes/transform.ts | tools/transform.ts | nodes/transform.tsx |
| triggers | — (특수) | — | nodes/triggers.tsx |
| ttl_cache | nodes/ttl-cache.ts | tools/ttl-cache.ts | nodes/ttl-cache.tsx |
| validator | nodes/validator.ts | tools/validator.ts | nodes/validator.tsx |
| vector_store | nodes/vector-store.ts | tools/vector-store.ts | nodes/vector-store.tsx |
| wait | nodes/wait.ts | — | nodes/wait.tsx |
| web_form | nodes/web-form.ts | tools/web-form.ts | nodes/web-form.tsx |
| web_scrape | nodes/web-scrape.ts | tools/web.ts | nodes/web-scrape.tsx |
| web_search | nodes/web-search.ts | tools/web.ts | nodes/web-search.tsx |
| web_table | nodes/web-table.ts | tools/web-table.ts | nodes/web-table.tsx |
| webhook | nodes/webhook.ts | tools/webhook.ts | nodes/webhook.tsx |
| websocket | nodes/websocket.ts | tools/websocket.ts | nodes/websocket.tsx |
| xml | nodes/xml.ts | tools/xml.ts | nodes/xml.tsx |
| yaml | nodes/yaml.ts | tools/yaml.ts | nodes/yaml.tsx |

### 프론트 없는 백엔드 노드
| node_type | 백엔드 파일 | 비고 |
|-----------|-----------|------|
| filesystem_watch | nodes/filesystem-watch.ts | 프론트 없음 |

### 도구만 있고 노드 없는 것 (주요 항목)
| 도구 | 파일 | 통합/추가 가능 노드 |
|------|------|-------------------|
| ascii-art | tools/ascii-art.ts | diagram 또는 신규 |
| base-convert | tools/base-convert.ts | encoding에 통합 |
| bloom-filter | tools/bloom-filter.ts | 신규 or set-ops |
| checksum | tools/checksum.ts | hash에 통합 |
| color | tools/color.ts | 신규 |
| cors | tools/cors.ts | http에 통합 |
| country | tools/country.ts | 신규 |
| currency | tools/currency.ts | math/format에 통합 |
| data-mask | tools/data-mask.ts | ✅ 노드 있음 |
| dns | tools/dns.ts | network에 통합 |
| dotenv | tools/dotenv.ts | 신규 or system-info |
| email-validate | tools/email-validate.ts | validator에 통합 |
| env | tools/env.ts | system-info에 통합 |
| feature-flag | tools/feature-flag.ts | 신규 or gate |
| file-request | tools/file-request.ts | http에 통합 |
| geo | tools/geo.ts | 신규 |
| glob-match | tools/glob-match.ts | 신규 or file |
| msgpack | tools/msgpack.ts | encoding에 통합 |
| notification | tools/notification.ts | notify에 통합 |
| oauth-fetch | tools/oauth-fetch.ts | oauth에 통합 |
| pagination | tools/pagination.ts | 신규 or aggregate |
| phone | tools/phone.ts | ✅ 노드 있음 |
| policy-tool | tools/policy-tool.ts | gate에 통합 |
| prometheus | tools/prometheus.ts | 신규 |
| protobuf | tools/protobuf.ts | 신규 or encoding |
| random | tools/random.ts | 신규 |
| robots-txt | tools/robots-txt.ts | web-scrape에 통합 |
| semver | tools/semver.ts | 신규 |
| sentiment | tools/sentiment.ts | analyzer에 통합 |
| sitemap | tools/sitemap.ts | web-scrape에 통합 |
| slug | tools/slug.ts | text에 통합 |
| ssh | tools/ssh.ts | ✅ 노드 있음 |
| store | tools/store.ts | ✅ cache/db 노드 |
| svg | tools/svg.ts | 신규 or image |
| syslog | tools/syslog.ts | log_parser에 통합 |
| timeseries | tools/timeseries.ts | 신규 |
| timezone | tools/timezone.ts | date-calc에 통합됨 |
| toml | tools/toml.ts | yaml에 통합 |
| tree | tools/tree.ts | 신규 or file |
| unit-convert | tools/unit-convert.ts | math에 통합 |
| url | tools/url.ts | 신규 |
| user-agent | tools/user-agent.ts | http에 통합 |
| uuid | tools/uuid.ts | encoding에 이미 있음 |
| vcard | tools/vcard.ts | 신규 |
| web-auth | tools/web-auth.ts | oauth/http에 통합 |
| whois | tools/whois.ts | network에 통합 |

---

## Phase 1: 프론트엔드 노드 점검 현황

### 완료 (✅)
| 노드 | 이슈 수정 내용 |
|------|-------------|
| aggregate | separator 추가 |
| archive | 이상 없음 |
| batch | 이상 없음 |
| changelog | result→object |
| compress | 이상 없음 |
| cookie | result→object |
| crypto | iv/auth_tag/signature 추가 |
| csv | columns/filter_col/filter_val 추가 |
| data-format | 이상 없음 |
| database | 이상 없음 |
| date-calc | step_days 추가 |
| diagram | 이상 없음 |
| docker | 이상 없음 |
| document-docx | 이상 없음 |
| document-pdf | 이상 없음 |
| document-pptx | 이상 없음 |
| document-xlsx | 이상 없음 |
| duration | duration2/ms 추가 |
| email | 이상 없음 |
| encoding | 이상 없음 |
| eval | 이상 없음 |
| file | 미검토 후 이상 없음 (단순) |
| filter | 이상 없음 |
| format | 이상 없음 |
| ftp | local_path 추가 (프론트+백엔드) |
| git | 이상 없음 |
| graph | result→object |
| hash | key/expected 추가 |
| html | allowed_tags, SELECTOR_ACTIONS 수정 |
| image | gravity 추가 |
| json_schema | schema2/target_draft 추가 |
| jwt | expires_in 추가 |
| ldap | 이상 없음 |
| log_parser | output→records/count |
| markdown | alt 추가 |
| math | 이상 없음 |
| matrix | result→object |
| media | unimplemented actions 제거 |
| memory-rw | 이상 없음 |
| mqtt | 이상 없음 |
| network | 이상 없음 |
| openapi | 이상 없음 |
| package-manager | 이상 없음 |
| password | result→object |
| pdf | pages/max_chars 추가 |
| process | 이상 없음 |
| redis | result→object |
| regex | 이상 없음 |
| rss | items 추가 |
| s3 | result→object |
| shell | 이상 없음 |
| similarity | 미검토 후 이상 없음 |
| split | 이상 없음 |
| sql_builder | sql/limit 추가 |
| state_machine | result→object |
| stats | 이상 없음 |
| template-engine | 이상 없음 |
| text | 이상 없음 |
| text-splitter | 이상 없음 |
| tokenizer | result→object |
| transform | 이상 없음 |
| ttl-cache | 이상 없음 |
| validator | 이상 없음 |
| web-search | 이상 없음 |
| websocket | 이상 없음 |
| xml | generate placeholder 수정 |
| yaml | generate placeholder, create_default 수정 |

### 이터레이션 3에서 완료 (✅)
| 노드 | 수정 내용 |
|------|---------|
| ai-agent | 이상 없음 |
| analyzer | 이상 없음 |
| approval | channel/chat_id 추가 |
| assert | 이상 없음 |
| barcode | 이상 없음 |
| cache | 이상 없음 |
| circuit_breaker | 이상 없음 |
| code | 이상 없음 |
| code_diagram | actors/messages 추가 |
| data_mask | 이상 없음 |
| db | 이상 없음 |
| decision | rationale/priority/tags/scope_id/target_id 추가 |
| diff | 이상 없음 |
| embedding | 이상 없음 |
| error-handler | fallback_nodes 추가 |
| escalation | 이상 없음 |
| form | channel/chat_id 추가 |
| gate | 이상 없음 |
| graphql | 이상 없음 |
| healthcheck | host/endpoints 추가 |
| hitl | channel/chat_id/fallback_value 추가 |
| http | 이상 없음 |
| if | 이상 없음 |
| kanban-trigger | 이상 없음 |
| llm | 이상 없음 |
| lookup | 이상 없음 |
| loop | 이상 없음 (이전 확인) |
| merge | 이상 없음 (이전 확인) |
| notify | channel/chat_id/parse_mode 추가 (이전 확인) |
| oauth | auth_url 등 추가 (이전 확인) |
| phone | number2/format_type 추가 |
| promise | rationale/priority/tags/scope_id/target_id 추가 |
| qr | 이상 없음 |
| rate_limit | output_schema: allowed/remaining으로 수정 |
| retriever | method/file_path 추가 |
| retry | 이상 없음 (이전 확인) |
| screenshot | 이상 없음 |
| secret-read | 이상 없음 |
| send-file | caption/channel/chat_id 추가 |
| set | 이상 없음 |
| set-ops | 이상 없음 |
| spawn-agent | 이상 없음 |
| ssh | local_path/remote_path 추가 (이전 확인) |
| sub-workflow | 이상 없음 |
| switch | 이상 없음 (이전 확인) |
| system-info | 이상 없음 |
| table | 이상 없음 |
| task | channel/chat_id 추가 |
| template | 이상 없음 |
| tool-invoke | 이상 없음 |
| triggers | 이상 없음 (filesystem_watch trigger 포함 확인) |
| vector-store | query_vector_field 등 추가 |
| wait | webhook_path/approval_message 추가 (이전 확인) |
| web-form | 이상 없음 |
| web-scrape | 이상 없음 |
| web-table | 이상 없음 |
| webhook | response_status/response_body 추가 (이전 확인) |

**Phase 1 완료! ✅ 모든 노드 점검 완료**

---

## Phase 2: 통합/신규 액션 추가 기회 (우선순위 순)

### 높은 우선순위 (완료 ✅)
| 작업 | 상태 |
|------|------|
| encoding에 base_convert 추가 | ✅ 완료 |
| encoding에 msgpack_encode/decode 추가 | ✅ 완료 |
| network에 whois 추가 | ✅ 완료 |
| hash에 crc32/adler32 추가 | ✅ 완료 |
| validator에 email operation 추가 | ✅ 완료 |
| yaml에 TOML format 지원 | ✅ 완료 |
| analyzer에 sentiment mode 추가 | ✅ 완료 |
| web-scrape에 robots_txt/sitemap 추가 | ✅ 완료 |
| log_parser syslog | ✅ 이미 구현됨 (LogParserTool.parse_syslog) |

### 중간 우선순위 (완료 ✅)
| 작업 | 상태 |
|------|------|
| http에 user-agent 추가 | ✅ 완료 (http.tsx user_agent 필드 + http.ts 헤더 설정) |
| text에 filename_safe/transliterate 추가 | ✅ 완료 (text.tsx + text.ts SlugTool 위임) |
| math에 unit-convert 통합 | ✅ MathTool 이미 convert 내장 (temperature 포함) |
| network dns DnsTool 업그레이드 | ✅ 완료 (dns_record_type 드롭다운 추가, MX/TXT/NS/CNAME/SRV 지원) |

### 낮은 우선순위 (신규 노드) — 완료 ✅
| 작업 | 상태 |
|------|------|
| url.ts → url 노드 신규 구현 | ✅ 완료 |
| random.ts → random 노드 신규 구현 | ✅ 완료 |
| semver.ts → semver 노드 신규 구현 | ✅ 완료 |
| color.ts → color 노드 신규 구현 | ✅ 완료 |

### 추가 통합 (이터레이션 5) — 완료 ✅
| 작업 | 상태 |
|------|------|
| math에 currency 통합 (info/format/convert/list/compare/parse) | ✅ 완료 |
| encoding에 protobuf 통합 (define/encode/decode/to_proto) | ✅ 완료 |
| regex에 glob_test/glob_filter 추가 | ✅ 완료 |
| document-*.ts 4파일 → document.ts 팩토리 통합 (DRY) | ✅ 완료 |

---

## Phase 3: i18n 체크

### 수정 완료
- ✅ `workflows.html_selector`
- ✅ `workflows.html_allowed_tags`
- ✅ `workflows.json_schema_target_draft`
- ✅ `workflows.date_calc_step_days`
- ✅ `workflows.field_local_path`

### 추가 완료
- ✅ `workflows.encoding_base_from` / `workflows.encoding_base_to`
- ✅ `workflows.validator_email_action`
- ✅ `workflows.analyzer_mode`
- ✅ `workflows.http_user_agent`
- ✅ i18n 중복 키 제거 (이전 세션 실수, en.json/ko.json 정리)
- ✅ `workflows.math_currency_action/code/amount` (이터레이션 5)
- ✅ `workflows.encoding_protobuf_schema/hint` (이터레이션 5)
- ✅ `workflows.field_to` 추가 (이터레이션 5)
- ✅ url/random/semver/color 신규 노드 i18n 전체 완료 (이터레이션 5)
- ✅ `workflows.ini_section` / `workflows.ini_key` — yaml.tsx INI query 누락 키 추가 (이터레이션 5)

---

## Phase 4: 미구현/문제 노드

| 노드 | 문제 | 상태 |
|------|------|------|
| filesystem_watch | triggers.tsx에 trigger_filesystem_watch로 구현됨 | ✅ |
| media (transcode/thumbnail) | 백엔드 미구현 | ✅ 수정됨 |

---

## 커밋 이력
1. `fix: 워크플로우 노드 UI/파라미터 결함 수정 (1차)` — output_schema, media 수정
2. `fix: 워크플로우 노드 UI/파라미터 결함 수정 (2차)` — create_default, i18n, ftp local_path
3. `fix: 워크플로우 노드 UI/파라미터 결함 수정 (3차)` — notify/oauth/ssh/wait/webhook + CHECKLIST.md
4. `fix: 워크플로우 노드 UI/파라미터 결함 수정 (4차)` — approval/code_diagram/decision/error-handler/form/healthcheck/hitl/phone/promise/retriever/send-file/task/vector-store/rate_limit
5. `feat: hash crc32/adler32 지원, network whois 추가`
6. `feat: 워크플로우 노드 Phase 2 — 도구 통합 및 액션 확장` — encoding base_convert/msgpack, yaml TOML, validator email, analyzer sentiment, web-scrape robots_txt/sitemap
7. `fix: Phase 2 타입/i18n 정비` — workflow-node.types.ts 타입 정의 보완, i18n 중복 키 제거, validator create_default 수정
8. `feat: Phase 3 — url/random/semver/color 신규 노드 추가` — 4개 도구 대응 노드 구현, i18n 완성, math/encoding/regex 추가 통합
9. `refactor: document 노드 핸들러 4파일 → make_document_handler 팩토리 통합` — DRY 리팩토링
10. `feat: Phase 5 — geo/country/jsonl/ical/json_patch 신규 노드 추가` — 5개 도구 대응 신규 노드, i18n 완성, yaml INI/network IP 통합 완성, CHECKLIST 최종 업데이트
11. `feat: Phase 6 — timeseries/dependency/mime/http-header/license 도구 기존 노드 통합` — stats/package-manager/data-format/changelog 노드 확장, 프론트엔드 UI 업데이트, i18n 완성
12. `fix: geo.tsx DMS placeholder 따옴표 이스케이프 오류 수정`
13. `feat: Phase 7 — svg/prometheus 신규 노드 추가` — SVG 프리미티브/차트 + Prometheus 메트릭 노드, i18n 완성
14. `fix: Phase 7 i18n 보충 — pdf/csv/xml/graph/matrix/similarity/tokenizer 스키마 설명 키 추가` — 30개 node.xxx.input/output 누락 키 추가
15. `feat: Phase 8 — vcard/ascii_art/pagination/tree_data 신규 노드 추가` — 미통합 도구 4개 신규 노드 구현, i18n 완성
16. `fix: Phase 9 — vcard.tsx 미사용 변수 제거, yaml 노드 dotenv 통합` — dotenv parse/generate/merge/validate/diff, required_keys 필드 추가

---

## Phase 5: 최종 검증

### 도구-노드 연결 확인 (이터레이션 5)
| 도구 | 통합 결과 |
|------|---------|
| base-convert | ✅ encoding.base_convert |
| checksum | ✅ hash.crc32/adler32 (ChecksumTool 위임) |
| dns | ✅ network.dns → DnsTool (MX/TXT/NS/CNAME 지원) |
| email-validate | ✅ validator.email |
| glob-match | ✅ regex.glob_test/glob_filter |
| msgpack | ✅ encoding.msgpack_encode/decode |
| protobuf | ✅ encoding.protobuf_define/encode/decode/to_proto |
| robots-txt | ✅ web-scrape.robots_txt |
| sentiment | ✅ analyzer.sentiment mode |
| sitemap | ✅ web-scrape.sitemap |
| slug | ✅ text.filename_safe/transliterate |
| toml | ✅ yaml.format=toml |
| url | ✅ 신규 url 노드 |
| random | ✅ 신규 random 노드 |
| semver | ✅ 신규 semver 노드 |
| color | ✅ 신규 color 노드 |
| currency | ✅ math.currency |
| user-agent | ✅ http.user_agent 필드 |
| whois | ✅ network.whois |
| geo | ✅ 신규 geo 노드 (distance/bearing/midpoint/bbox/geohash/dms) |
| country | ✅ 신규 country 노드 (lookup/search/by_dial_code/by_currency/by_continent/list) |
| jsonl | ✅ 신규 jsonl 노드 (parse/generate/filter/count/head/tail/map/unique) |
| ical | ✅ 신규 ical 노드 (generate/parse/add_event/validate) |
| json-patch | ✅ 신규 json_patch 노드 (apply/diff/validate/test — RFC 6902) |

### 미통합 도구 (의도적 제외)
| 도구 | 이유 |
|------|------|
| bloom-filter | set-ops와 도메인 다름, 독립 노드로 가치 낮음 |
| cors | HTTP 요청과 CORS 헤더 생성은 다른 도메인 |
| dotenv/env | system-info에 통합 가능하나 사용 빈도 낮음 |
| feature-flag | gate 노드와 의존성 깊음 (store 필요) |
| file-request | http와 목적 중복, multipart upload는 별도 고려 |
| pagination | aggregate와 목적 다름, 독립 노드 후보 |
| policy-tool | DecisionService store 의존성 — 직접 노드로 적합하지 않음 |
| tree | file 노드에 통합 가능하나 우선순위 낮음 |
| vcard | 독립 노드 후보, 사용 빈도 낮음 |
| web-auth | oauth 노드와 복잡한 통합 필요 |

**결론: 모든 실용적 통합 완료. 나머지는 YAGNI.**

**Phase 5 검증 완료 ✅**

---

## Phase 6: 도구 심층 통합

### 통합된 도구 (이터레이션 6)
| 도구 | 통합 결과 |
|------|---------|
| timeseries | ✅ stats 노드 (moving_average/ema/linear_forecast/anomaly/diff/cumsum/autocorrelation) |
| dependency | ✅ package-manager 노드 (parse_deps/circular_deps/dep_stats/dep_compare) |
| mime | ✅ data-format 노드 (mime_lookup/mime_detect/mime_parse/mime_reverse) |
| http-header | ✅ data-format 노드 (header_parse/header_content_type/header_cache_control/header_authorization/header_content_disposition) |
| license | ✅ changelog 노드 (license_generate/license_detect/license_info/license_compare/license_list/license_compatible) |

### 변경된 파일
- `src/agent/nodes/stats.ts` — TimeseriesTool 위임 로직 추가
- `src/agent/nodes/package-manager.ts` — DependencyTool 위임 로직 추가
- `src/agent/nodes/data-format.ts` — MimeTool + HttpHeaderTool 위임 로직 추가
- `src/agent/nodes/changelog.ts` — LicenseTool 위임 로직 추가
- `web/src/pages/workflows/nodes/stats.tsx` — TimeSeries optgroup + 파라미터 필드
- `web/src/pages/workflows/nodes/package-manager.tsx` — Dependency Analysis optgroup + 입력 필드
- `web/src/pages/workflows/nodes/data-format.tsx` — MIME/HTTP Header optgroup + 입력 필드
- `web/src/pages/workflows/nodes/changelog.tsx` — License optgroup + 입력 필드
- `src/agent/workflow-node.types.ts` — 5개 인터페이스에 신규 필드 추가
- `src/i18n/locales/en.json` + `ko.json` — Phase 6 신규 키 추가

**Phase 6 검증 완료 ✅**

---

## Phase 7: 미통합 도구 재검증 및 신규 노드

### 검증 결과 (이터레이션 7)
| 도구 | 상태 |
|------|------|
| ini.ts | ✅ yaml 노드에 이미 통합됨 (format=ini) |
| ip.ts | ✅ network 노드에 이미 통합됨 (operation=ip) |
| svg.ts | ✅ 신규 svg 노드 (chart/primitives/to_data_uri) |
| prometheus.ts | ✅ 신규 prometheus 노드 (format/parse/push/query_format) |
| metric.ts | ⏭ 스킵 (stateful, in-memory 누적 — 워크플로우 노드 부적합) |
| dotenv.ts | ⏭ YAGNI 유지 (yaml/ini와 유사, 사용 빈도 낮음) |
| env.ts | ⏭ YAGNI 유지 (system-info가 환경변수 커버) |
| csp.ts | ⏭ YAGNI 유지 (보안 정책 관리, 사용 빈도 낮음) |
| approval-parser.ts | ⏭ 내부 유틸리티, 별도 노드 불필요 |
| ask-user.ts | ⏭ hitl/approval 노드에서 이미 구현됨 |

### i18n 검증 (이터레이션 7)
- ✅ geo/country/jsonl/ical/json_patch/data-format/changelog/package-manager 모든 키 확인 완료 (68개)
- ✅ svg/prometheus 신규 키 추가
- ✅ pdf/csv/xml/graph/matrix/similarity/tokenizer node.xxx.input/output 스키마 설명 키 30개 추가 (이터레이션 7 보충)

### 버그 수정
- ✅ geo.tsx DMS placeholder 따옴표 이스케이프 오류 수정

**Phase 7 검증 완료 ✅**

---

## Phase 8: 미통합 도구 신규 노드 추가

### 도구 분석 결과 (이터레이션 8)
| 도구 | 결정 | 이유 |
|------|------|------|
| ascii-art.ts | ✅ 신규 ascii_art 노드 | 텍스트 포매팅 특화 (6 actions) |
| vcard.ts | ✅ 신규 vcard 노드 | 연락처 포맷 변환 (5 actions) |
| pagination.ts | ✅ 신규 pagination 노드 | API 메타데이터 계산 (6 actions) |
| tree.ts | ✅ 신규 tree_data 노드 | 트리 자료구조 알고리즘 (7 actions) |
| glob-match.ts | ⏭ 이미 regex 노드에 glob_test/glob_filter로 통합 (Phase 2) |
| cors.ts | ⏭ YAGNI (서버사이드 정책 전용, 워크플로우 클라이언트 불필요) |
| bloom-filter.ts | ⏭ YAGNI (틈새 확률 자료구조, 사용 빈도 낮음) |
| feature-flag.ts | ⏭ YAGNI (in-memory 상태, 워크플로우 stateless 특성과 불일치) |
| web-auth.ts | ⏭ YAGNI (브라우저 자동화 세션, screenshot/web-scrape 노드로 충분) |
| policy-tool.ts | ⏭ YAGNI (decision 노드와 목적 유사, 중복) |

### 노드 매핑 테이블 추가
| 노드 | 백엔드 | 도구 | 프론트 |
|------|--------|------|--------|
| vcard | nodes/vcard.ts | tools/vcard.ts | nodes/vcard.tsx |
| ascii_art | nodes/ascii-art.ts | tools/ascii-art.ts | nodes/ascii-art.tsx |
| pagination | nodes/pagination.ts | tools/pagination.ts | nodes/pagination.tsx |
| tree_data | nodes/tree-data.ts | tools/tree.ts | nodes/tree-data.tsx |

**Phase 8 완료 ✅**

---

## Phase 9: 버그 수정 및 dotenv 통합

### 수정 사항
| 항목 | 내용 |
|------|------|
| vcard.tsx | ✅ 미사용 변수 `needs_input_fields` 제거 (논리 오류 포함) |
| yaml 노드 | ✅ dotenv 포맷 통합 (format="dotenv") — DotenvTool 위임 |
| yaml.tsx | ✅ `.env` 옵션 추가 (parse/generate/merge/validate/diff actions) |
| yaml.tsx | ✅ dotenv validate용 `required_keys` 입력 필드 추가 |
| YamlNodeDefinition | ✅ required_keys 필드 추가 |

### 이터레이션 9 도구 재검토
| 도구 | 결정 | 이유 |
|------|------|------|
| csp.ts | ⏭ YAGNI | 서버사이드 보안 헤더, 낮은 사용 빈도 |
| dotenv.ts | ✅ yaml 노드 통합 | TOML/INI 패턴과 동일한 확장 |
| env.ts | ⏭ 도구로 유지 | system-info와 별개 관심사 |
| metric.ts | ⏭ 도구로 유지 | in-memory 상태, 워크플로우 부적합 |
| approval-parser.ts | ⏭ 내부 유틸리티 | 별도 Tool 클래스 아님 |
| ask-user.ts | ⏭ hitl 노드로 충분 | AskUserTool은 저수준 |

**Phase 9 완료 ✅**
