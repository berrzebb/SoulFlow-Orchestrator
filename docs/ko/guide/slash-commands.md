# 슬래시 커맨드 레퍼런스

채팅 채널에서 직접 입력하는 제어 명령어입니다.

## 일반

| 커맨드 | 설명 |
|--------|------|
| `/help` | 사용 가능한 명령어 목록 출력 |
| `/status` | 런타임 상태 · 도구 · 스킬 목록 요약 |
| `/stats` | 런타임 통계 (CD 점수 · 세션 메트릭) |
| `/doctor` | 서비스 건강 상태 자가진단 |
| `/stop` · `/cancel` · `/중지` | 현재 채널 활성 작업 즉시 중지 |
| `/verify` | 마지막 출력물 검증 |

## 렌더링

| 커맨드 | 설명 |
|--------|------|
| `/render status` | 현재 렌더 모드 확인 |
| `/render markdown` · `html` · `plain` | 렌더 모드 변경 |
| `/render reset` | 기본값으로 초기화 |
| `/render link indicator\|text\|remove` | 차단된 링크 표현 방식 |
| `/render image indicator\|text\|remove` | 차단된 이미지 표현 방식 |

## 보안 Vault

| 커맨드 | 설명 |
|--------|------|
| `/secret status` | Vault 상태 확인 |
| `/secret list` | 저장된 키 목록 |
| `/secret set <key> <value>` | 암호화 저장 |
| `/secret get <key>` | 참조값 조회 |
| `/secret reveal <key>` | 실제 값 확인 |
| `/secret remove <key>` | 삭제 |
| `/secret encrypt <text>` | 일회성 암호화 |
| `/secret decrypt <cipher>` | 일회성 복호화 |

## 메모리

| 커맨드 | 설명 |
|--------|------|
| `/memory status` | 메모리 상태 요약 |
| `/memory list` | 날짜별 메모리 목록 |
| `/memory today` | 오늘 메모리 내용 |
| `/memory longterm` | 장기 메모리 전체 |
| `/memory search <q>` | 키워드 검색 |

## 태스크

| 커맨드 | 설명 |
|--------|------|
| `/task list` | 실행 중인 태스크 목록 |
| `/task cancel <id>` | 태스크 취소 |

## 에이전트

| 커맨드 | 설명 |
|--------|------|
| `/agent list` | 서브에이전트 목록 |
| `/agent cancel <id>` | 서브에이전트 취소 |
| `/agent send <id> <message>` | 서브에이전트에 메시지 전달 |

## 스킬

| 커맨드 | 설명 |
|--------|------|
| `/skill list` | 사용 가능한 스킬 목록 |
| `/skill info <name>` | 스킬 상세 정보 |
| `/skill suggest` | 현재 요청에 적합한 스킬 추천 |

## 결정사항

| 커맨드 | 설명 |
|--------|------|
| `/decision status` | 결정사항 시스템 상태 |
| `/decision list` | 저장된 결정사항 목록 |
| `/decision set <key> <value>` | 결정사항 저장 |

## Promise / 지연 실행

| 커맨드 | 설명 |
|--------|------|
| `/promise status` | Promise 상태 |
| `/promise list` | 대기 중인 Promise 목록 |
| `/promise resolve <id> <value>` | Promise 해결 |

## 크론

| 커맨드 | 설명 |
|--------|------|
| `/cron status` | 크론 스케줄 상태 |
| `/cron list` | 등록된 잡 목록 |
| `/cron add <표현식> <명령>` | 잡 등록 |
| `/cron remove <id>` | 잡 삭제 |

## 확인 가드

| 커맨드 | 설명 |
|--------|------|
| `/guard` | 가드 상태 확인 (활성/비활성, 대기 중 건수) |
| `/guard on` | 확인 가드 활성화 — 크론 작업이나 장기 실행 작업 전 확인 요청 |
| `/guard off` | 확인 가드 비활성화 |

## 핫 리로드

| 커맨드 | 설명 |
|--------|------|
| `/reload config` | 설정 리로드 |
| `/reload tools` | 도구 리로드 |
| `/reload skills` | 스킬 리로드 |
