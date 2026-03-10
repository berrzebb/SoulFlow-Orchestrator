# 워크플로우 구조 패턴

사용 빈도 높은 패턴별 최소 구조 예시.

## 패턴 선택 기준

| 조건 | 패턴 |
|------|------|
| 단순 순차 처리 | Linear Pipeline |
| 품질 기준 통과 필요 | Closed-Loop Critic |
| 독립 작업 동시 처리 | Parallel Agents |
| 분기/조건부 흐름 | DAG (Style B) |
| 사람 검토 포함 | HITL Gate |

---

## 1. Linear Pipeline (순차 처리)

```json
{
  "title": "리서치 → 초안 → 검토",
  "phases": [
    {
      "phase_id": "research",
      "title": "리서치",
      "agents": [{"agent_id": "r1", "role": "researcher", "backend": "<backend_id>", "system_prompt": "..."}]
    },
    {
      "phase_id": "write",
      "title": "초안 작성",
      "agents": [{"agent_id": "w1", "role": "writer", "backend": "<backend_id>", "system_prompt": "..."}]
    },
    {
      "phase_id": "review",
      "title": "검토",
      "agents": [{"agent_id": "rv1", "role": "reviewer", "backend": "<backend_id>", "system_prompt": "..."}]
    }
  ]
}
```

---

## 2. Closed-Loop Critic (자동 재시도)

품질 기준 통과 시까지 draft → review 루프 반복.

```json
{
  "title": "자동 품질 루프",
  "phases": [
    {
      "phase_id": "draft",
      "title": "초안 작성",
      "agents": [{"agent_id": "w1", "role": "writer", "backend": "<backend_id>", "system_prompt": "..."}]
    },
    {
      "phase_id": "review",
      "title": "비평 검토",
      "agents": [{"agent_id": "rv1", "role": "reviewer", "backend": "<backend_id>", "system_prompt": "..."}],
      "critic": {
        "backend": "<backend_id>",
        "gate": true,
        "on_rejection": "goto",
        "goto_phase": "draft",
        "max_retries": 3,
        "system_prompt": "APPROVED 또는 REJECTED\\n이유: [구체적 근거]\\n개선 방향: [지시사항]"
      }
    }
  ]
}
```

**설계 제약**:
- `goto_phase`는 반드시 비평 phase **이전**의 `phase_id`
- critic `system_prompt`는 APPROVED/REJECTED 판정을 명시적으로 출력해야 함
- `max_retries` 미설정 시 기본값 1 (무한 루프 방지)

---

## 3. Parallel Agents (병렬 처리)

독립 작업을 동시에 실행 후 결과 통합.

```json
{
  "title": "병렬 분석",
  "phases": [
    {
      "phase_id": "analyze",
      "title": "병렬 분석",
      "mode": "parallel",
      "agents": [
        {"agent_id": "a1", "role": "analyst-a", "backend": "<backend_id>", "system_prompt": "관점 A에서 분석..."},
        {"agent_id": "a2", "role": "analyst-b", "backend": "<backend_id>", "system_prompt": "관점 B에서 분석..."}
      ]
    },
    {
      "phase_id": "merge",
      "title": "결과 통합",
      "agents": [{"agent_id": "m1", "role": "synthesizer", "backend": "<backend_id>", "system_prompt": "두 분석을 통합..."}]
    }
  ]
}
```

---

## 4. DAG (분기/데이터 변환, Style B)

복잡한 제어 흐름이 필요할 때. `node_types` action으로 사용 가능한 노드 확인 필수.

```json
{
  "title": "데이터 파이프라인",
  "orche_nodes": [
    {"node_id": "fetch", "node_type": "http_request", "title": "데이터 수집", "params": {"url": "...", "method": "GET"}},
    {"node_id": "transform", "node_type": "json_transform", "title": "변환", "depends_on": ["fetch"], "params": {"...": "..."}},
    {"node_id": "ai", "node_type": "ai_agent", "title": "분석", "depends_on": ["transform"], "params": {"system_prompt": "..."}}
  ],
  "trigger_nodes": [
    {"id": "t1", "trigger_type": "cron", "schedule": "0 9 * * 1", "timezone": "Asia/Seoul"}
  ]
}
```

---

## 5. HITL Gate (사람 검토 포함)

중간에 사람의 승인이 필요한 워크플로우.

```json
{
  "title": "사람 승인 포함",
  "phases": [
    {
      "phase_id": "draft",
      "agents": [{"agent_id": "w1", "role": "writer", "backend": "<backend_id>", "system_prompt": "..."}]
    },
    {
      "phase_id": "human_review",
      "mode": "interactive",
      "agents": [],
      "critic": {
        "gate": true,
        "on_rejection": "escalate"
      }
    },
    {
      "phase_id": "finalize",
      "agents": [{"agent_id": "f1", "role": "finalizer", "backend": "<backend_id>", "system_prompt": "..."}]
    }
  ]
}
```

---

## 트리거 유형별 설정

| 트리거 | 필드 |
|--------|------|
| `cron` | `schedule` (cron식), `timezone` |
| `webhook` | `webhook_path` |
| `channel_message` | `channel_type`, `chat_id` |
| `manual` | 추가 설정 없음 |
| `kanban_event` | `board_id`, `actions[]`, `column_id` |
