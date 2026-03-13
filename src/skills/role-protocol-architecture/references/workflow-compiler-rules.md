# Workflow Compiler Rules

workflow generator는 role policy를 재사용해야 한다.

핵심 규칙:

1. catalog를 먼저 조회한다
2. role baseline을 읽는다
3. 가능한 부분은 agentless/direct node로 내린다
4. 정말 필요한 부분만 `ai_agent` 또는 phase agent로 남긴다
5. role baseline을 새 문자열 prompt로 다시 창작하지 않는다

좋은 결과:

- agent-heavy workflow가 아니라 agent-minimized workflow
- runtime과 workflow generator가 같은 role baseline 사용
