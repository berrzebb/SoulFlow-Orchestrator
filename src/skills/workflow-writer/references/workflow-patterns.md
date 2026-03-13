# 워크플로우 구조 패턴

사용 빈도 높은 패턴별 최소 구조 예시.

## 패턴 선택 기준

| 조건 | 패턴 |
|------|------|
| 단순 순차 처리 | Linear Pipeline |
| 구현/검증을 닫힌 루프로 마감 | Bounded Closeout Loop |
| 짧은 품질 게이트만 필요 | Closed-Loop Critic |
| 독립 작업 동시 처리 | Parallel Agents |
| 병렬 결과를 비교 후 수렴 | Parallel + Critic Convergence |
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

## 2. Bounded Closeout Loop (권장 클로즈드 루프)

구현, 리뷰, 수정, 검증을 분리하고 `goto`와 `max_retries`로 반복 범위를 제한한다.

```json
{
  "title": "구현 클로즈아웃 루프",
  "phases": [
    {
      "phase_id": "implement",
      "title": "구현",
      "mode": "sequential_loop",
      "max_loop_iterations": 30,
      "agents": [
        {
          "agent_id": "impl1",
          "role": "implementer",
          "backend": "<backend_id>",
          "system_prompt": "다음 미완료 작업을 수행하라. 막히면 [ASK_USER], 완료되면 [DONE]을 출력하라."
        }
      ]
    },
    {
      "phase_id": "review",
      "title": "검토",
      "depends_on": ["implement"],
      "agents": [
        {
          "agent_id": "rv1",
          "role": "reviewer",
          "backend": "<backend_id>",
          "system_prompt": "요구사항과 회귀 위험 기준으로 결과를 검토하라."
        }
      ]
    },
    {
      "phase_id": "fix",
      "title": "수정",
      "depends_on": ["review"],
      "mode": "sequential_loop",
      "max_loop_iterations": 10,
      "agents": [
        {
          "agent_id": "fix1",
          "role": "debugger",
          "backend": "<backend_id>",
          "system_prompt": "리뷰 이슈만 수정하라. 남은 이슈가 없으면 [DONE]을 출력하라."
        }
      ]
    },
    {
      "phase_id": "validate",
      "title": "검증",
      "depends_on": ["fix"],
      "agents": [
        {
          "agent_id": "val1",
          "role": "validator",
          "backend": "<backend_id>",
          "system_prompt": "테스트, 타입체크, 검증 결과를 보고하라."
        }
      ],
      "critic": {
        "backend": "<backend_id>",
        "gate": true,
        "on_rejection": "goto",
        "goto_phase": "fix",
        "max_retries": 2,
        "system_prompt": "PASS 또는 REJECTED를 명시하고, 실패 시 fix phase가 처리할 구체적 이슈만 남겨라."
      }
    }
  ]
}
```

**설계 규칙**:
- 먼저 `PASS 조건`, `FAIL 조건`, `에스컬레이션 조건`을 적고 시작한다.
- `goto_phase`는 한 군데만 둔다. 여러 phase로 점프시키지 않는다.
- `max_loop_iterations`와 `max_retries`를 항상 명시한다.
- 반복 실패가 예상되면 마지막 게이트는 `escalate` 또는 `interactive` phase로 빠질 수 있게 둔다.
- 구현/수정 phase는 `sequential_loop`, 판단/검토 phase는 일반 phase로 분리한다.

---

## 3. Closed-Loop Critic (자동 재시도)

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

## 4. Parallel Agents (병렬 처리)

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

## 5. Parallel + Critic Convergence (병렬 수렴)

병렬 에이전트 결과를 바로 끝내지 말고, 통합 phase와 critic gate로 수렴시킨다.

```json
{
  "title": "병렬 분석 후 수렴",
  "phases": [
    {
      "phase_id": "analyze",
      "title": "병렬 분석",
      "mode": "parallel",
      "agents": [
        {"agent_id": "a1", "role": "analyst-a", "backend": "<backend_id>", "system_prompt": "관점 A에서 분석..."},
        {"agent_id": "a2", "role": "analyst-b", "backend": "<backend_id>", "system_prompt": "관점 B에서 분석..."},
        {"agent_id": "a3", "role": "analyst-c", "backend": "<backend_id>", "system_prompt": "리스크 관점에서 분석..."}
      ]
    },
    {
      "phase_id": "reconcile",
      "title": "결과 수렴",
      "depends_on": ["analyze"],
      "agents": [
        {
          "agent_id": "merge1",
          "role": "synthesizer",
          "backend": "<backend_id>",
          "system_prompt": "충돌 지점, 합의 지점, 남은 불확실성을 정리하고 단일 초안을 만든다."
        }
      ],
      "critic": {
        "backend": "<backend_id>",
        "gate": true,
        "on_rejection": "goto",
        "goto_phase": "analyze",
        "max_retries": 1,
        "system_prompt": "수렴 결과가 충분히 일관적인지 평가하라. 부족하면 어떤 관점이 누락되었는지 명시하라."
      }
    }
  ]
}
```

**설계 규칙**:
- 병렬 phase 뒤에는 가능한 한 바로 critic gate를 둔다.
- 병렬 agent끼리 직접 끝없이 반박하게 만들지 않는다.
- critic이 거절하면 전체 병렬 재실행보다 누락 관점 보강을 우선 지시한다.
- 1~2회 내에 수렴되지 않으면 사람 검토 또는 별도 decision phase로 넘긴다.

---

## 6. DAG (분기/데이터 변환, Style B)

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

## 7. HITL Gate (사람 검토 포함)

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
