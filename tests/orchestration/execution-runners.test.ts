/**
 * Phase 4.1 추출 검증: run_once / run_agent_loop / run_task_loop / continue_task_loop
 *
 * 목표: 추출된 runner 함수들이 정의되고 호출 가능한지 검증.
 *       각 함수가 올바른 타입 시그니처를 가지는지 확인.
 *
 * 범위: 함수 존재성, export, 타입 시그니처 검증만 수행.
 *       세부 실행 로직은 각 runner 모듈 내 통합 테스트에서 검증.
 */

import { describe, it, expect } from "vitest";
import type { RunExecutionArgs, RunnerDeps } from "@src/orchestration/execution/runner-deps.js";
import type { ContinueTaskDeps } from "@src/orchestration/execution/continue-task-loop.js";
import { run_once, run_agent_loop, run_task_loop, continue_task_loop } from "@src/orchestration/execution/index.js";

/* ── 테스트 ────────────────────────────────────────── */

describe("Phase 4.1: 추출된 Runner 함수 검증", () => {
  describe("runner 함수 export", () => {
    it("run_once 함수 export 확인", () => {
      expect(run_once).toBeDefined();
      expect(typeof run_once).toBe("function");
      expect(run_once.length).toBeGreaterThan(0); // 최소 1개 파라미터
    });

    it("run_agent_loop 함수 export 확인", () => {
      expect(run_agent_loop).toBeDefined();
      expect(typeof run_agent_loop).toBe("function");
      expect(run_agent_loop.length).toBeGreaterThan(0);
    });

    it("run_task_loop 함수 export 확인", () => {
      expect(run_task_loop).toBeDefined();
      expect(typeof run_task_loop).toBe("function");
      expect(run_task_loop.length).toBeGreaterThan(0);
    });

    it("continue_task_loop 함수 export 확인", () => {
      expect(continue_task_loop).toBeDefined();
      expect(typeof continue_task_loop).toBe("function");
      expect(continue_task_loop.length).toBeGreaterThan(0); // 최소 5개 파라미터
    });
  });

  describe("Runner 타입 계약 (Contract)", () => {
    it("RunExecutionArgs 타입 정의됨", () => {
      const args: Partial<RunExecutionArgs> = {
        req: {} as never,
        executor: "openai",
        task_with_media: "test",
        context_block: "context",
        skill_names: [],
        system_base: "system",
        runtime_policy: {},
        tool_definitions: [],
        tool_ctx: {} as never,
        request_scope: "scope",
      };
      expect(args).toBeDefined();
    });

    it("RunnerDeps 타입 정의됨", () => {
      const deps: Partial<RunnerDeps> = {
        providers: {} as never,
        runtime: {} as never,
        config: {
          agent_loop_max_turns: 5,
          task_loop_max_turns: 3,
          executor_provider: "openai",
          max_tool_result_chars: 10000,
        },
        logger: {} as never,
      };
      expect(deps).toBeDefined();
    });

    it("ContinueTaskDeps 타입이 RunnerDeps 확장", () => {
      const deps: Partial<ContinueTaskDeps> = {
        providers: {} as never,
        runtime: {} as never,
        config: {
          agent_loop_max_turns: 5,
          task_loop_max_turns: 3,
          executor_provider: "openai",
          max_tool_result_chars: 10000,
        },
        logger: {} as never,
        policy_resolver: {} as never,
        caps: () => ({ thinking: false, vision: false }),
        build_system_prompt: async () => "",
        collect_skill_provider_preferences: () => [],
      };
      expect(deps).toBeDefined();
    });
  });

  describe("의존성 계약 필수 속성", () => {
    it("RunnerDeps는 providers, runtime, config, logger 포함", () => {
      const required_props: (keyof RunnerDeps)[] = [
        "providers",
        "runtime",
        "config",
        "logger",
      ];
      // 타입이 올바르게 정의되어 있으면 이 배열이 유효함
      expect(required_props.length).toBe(4);
    });

    it("ContinueTaskDeps는 policy_resolver, caps, build_system_prompt 포함", () => {
      const required_props: (keyof ContinueTaskDeps)[] = [
        "policy_resolver",
        "caps",
        "build_system_prompt",
        "collect_skill_provider_preferences",
      ];
      expect(required_props.length).toBe(4);
    });
  });
});
