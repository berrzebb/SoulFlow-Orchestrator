# 워크플로우 노드/도구 종합 체크리스트

> 이 문서는 이터레이션마다 읽고 업데이트합니다.
> 마지막 업데이트: 2026-03-10 (이터레이션 2)

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
| filesystem_watch | nodes/filesystem-watch.ts | — | ❌ 없음 |
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

### 미완료 (🔍) — 이터레이션 2 대상
| 노드 | 파일 경로 |
|------|---------|
| ai-agent | web/src/pages/workflows/nodes/ai-agent.tsx |
| analyzer | web/src/pages/workflows/nodes/analyzer.tsx |
| approval | web/src/pages/workflows/nodes/approval.tsx |
| assert | web/src/pages/workflows/nodes/assert.tsx |
| barcode | web/src/pages/workflows/nodes/barcode.tsx |
| cache | web/src/pages/workflows/nodes/cache.tsx |
| circuit_breaker | web/src/pages/workflows/nodes/circuit_breaker.tsx |
| code | web/src/pages/workflows/nodes/code.tsx |
| code_diagram | web/src/pages/workflows/nodes/code_diagram.tsx |
| data_mask | web/src/pages/workflows/nodes/data_mask.tsx |
| db | web/src/pages/workflows/nodes/db.tsx |
| decision | web/src/pages/workflows/nodes/decision.tsx |
| diff | web/src/pages/workflows/nodes/diff.tsx |
| embedding | web/src/pages/workflows/nodes/embedding.tsx |
| error-handler | web/src/pages/workflows/nodes/error-handler.tsx |
| escalation | web/src/pages/workflows/nodes/escalation.tsx |
| form | web/src/pages/workflows/nodes/form.tsx |
| gate | web/src/pages/workflows/nodes/gate.tsx |
| graphql | web/src/pages/workflows/nodes/graphql.tsx |
| healthcheck | web/src/pages/workflows/nodes/healthcheck.tsx |
| hitl | web/src/pages/workflows/nodes/hitl.tsx |
| http | web/src/pages/workflows/nodes/http.tsx |
| if | web/src/pages/workflows/nodes/if.tsx |
| kanban-trigger | web/src/pages/workflows/nodes/kanban-trigger.tsx |
| llm | web/src/pages/workflows/nodes/llm.tsx |
| lookup | web/src/pages/workflows/nodes/lookup.tsx |
| loop | web/src/pages/workflows/nodes/loop.tsx |
| merge | web/src/pages/workflows/nodes/merge.tsx |
| notify | web/src/pages/workflows/nodes/notify.tsx |
| oauth | web/src/pages/workflows/nodes/oauth.tsx |
| phone | web/src/pages/workflows/nodes/phone.tsx |
| promise | web/src/pages/workflows/nodes/promise.tsx |
| qr | web/src/pages/workflows/nodes/qr.tsx |
| rate_limit | web/src/pages/workflows/nodes/rate_limit.tsx |
| retriever | web/src/pages/workflows/nodes/retriever.tsx |
| retry | web/src/pages/workflows/nodes/retry.tsx |
| screenshot | web/src/pages/workflows/nodes/screenshot.tsx |
| secret-read | web/src/pages/workflows/nodes/secret-read.tsx |
| send-file | web/src/pages/workflows/nodes/send-file.tsx |
| set | web/src/pages/workflows/nodes/set.tsx |
| set-ops | web/src/pages/workflows/nodes/set-ops.tsx |
| spawn-agent | web/src/pages/workflows/nodes/spawn-agent.tsx |
| ssh | web/src/pages/workflows/nodes/ssh.tsx |
| sub-workflow | web/src/pages/workflows/nodes/sub-workflow.tsx |
| switch | web/src/pages/workflows/nodes/switch.tsx |
| system-info | web/src/pages/workflows/nodes/system-info.tsx |
| table | web/src/pages/workflows/nodes/table.tsx |
| task | web/src/pages/workflows/nodes/task.tsx |
| template | web/src/pages/workflows/nodes/template.tsx |
| tool-invoke | web/src/pages/workflows/nodes/tool-invoke.tsx |
| triggers | web/src/pages/workflows/nodes/triggers.tsx |
| vector-store | web/src/pages/workflows/nodes/vector-store.tsx |
| wait | web/src/pages/workflows/nodes/wait.tsx |
| web-form | web/src/pages/workflows/nodes/web-form.tsx |
| web-scrape | web/src/pages/workflows/nodes/web-scrape.tsx |
| web-table | web/src/pages/workflows/nodes/web-table.tsx |
| webhook | web/src/pages/workflows/nodes/webhook.tsx |

---

## Phase 2: 통합/신규 액션 추가 기회 (우선순위 순)

### 높은 우선순위
| 작업 | 대상 파일 | 설명 |
|------|---------|------|
| encoding에 base-convert 추가 | nodes/encoding.tsx, nodes/encoding.ts | base2/8/16/32/64 변환 |
| encoding에 msgpack 추가 | nodes/encoding.tsx, nodes/encoding.ts | MessagePack 인코딩 |
| network에 dns 추가 | nodes/network.tsx, nodes/network.ts | DNS 조회 |
| network에 whois 추가 | nodes/network.tsx, nodes/network.ts | WHOIS 조회 |
| math에 unit-convert 추가 | nodes/math.tsx, nodes/math.ts | 단위 변환 |
| hash에 checksum 추가 | nodes/hash.tsx, nodes/hash.ts | CRC32, Adler32 |
| validator에 email-validate 추가 | nodes/validator.tsx, nodes/validator.ts | 상세 이메일 검증 |
| yaml에 toml 추가 | nodes/yaml.tsx, nodes/yaml.ts | TOML 파싱/생성 |
| analyzer에 sentiment 추가 | nodes/analyzer.tsx, nodes/analyzer.ts | 감성 분석 |
| text에 slug 추가 | nodes/text.tsx, nodes/text.ts | URL 슬러그 변환 |

### 중간 우선순위
| 작업 | 대상 파일 | 설명 |
|------|---------|------|
| http에 user-agent 추가 | nodes/http.tsx | UA 파싱 |
| web-scrape에 robots-txt 추가 | nodes/web-scrape.tsx | robots.txt 파싱 |
| web-scrape에 sitemap 추가 | nodes/web-scrape.tsx | sitemap 파싱 |
| log_parser에 syslog 추가 | nodes/log_parser.tsx | syslog 파싱 |

### 낮은 우선순위 (신규 노드 고려)
- url.ts → URL 파싱 노드
- random.ts → random 노드
- semver.ts → semver 노드
- color.ts → color 노드

---

## Phase 3: i18n 체크

### 수정 완료
- ✅ `workflows.html_selector`
- ✅ `workflows.html_allowed_tags`
- ✅ `workflows.json_schema_target_draft`
- ✅ `workflows.date_calc_step_days`
- ✅ `workflows.field_local_path`

### 추가 확인 필요
- 🔍 미검토 노드 57개의 t() 키 전체 스캔

---

## Phase 4: 미구현/문제 노드

| 노드 | 문제 | 상태 |
|------|------|------|
| filesystem_watch | 프론트엔드 없음 | ❌ |
| media (transcode/thumbnail) | 백엔드 미구현 | ✅ 수정됨 |

---

## 커밋 이력
1. `fix: 워크플로우 노드 UI/파라미터 결함 수정 (1차)` — output_schema, media 수정
2. `fix: 워크플로우 노드 UI/파라미터 결함 수정 (2차)` — create_default, i18n, ftp local_path
3. (다음) Phase 1 미완료 노드 검토
4. (다음) Phase 2 통합/신규 액션 추가
