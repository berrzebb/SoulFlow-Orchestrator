/**
 * E2E 테스트 러너 — Input + Solver 패턴.
 *
 * 테스트 케이스를 [input, solver]로 정의하고 러너에 전달.
 * 러너가 하네스 생성, 파이프라인 실행, solver 적용을 담당.
 *
 * 사용법:
 *   npx vitest run --config vitest.e2e.config.ts -t "케이스이름"
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  is_phi4_available,
  is_spotify_available,
  create_real_harness,
  inbound,
  type RealHarness,
} from "./harness.ts";
import type { ChannelProvider } from "@src/channels/types.ts";
import type { OrchestrationRequest, OrchestrationResult } from "@src/orchestration/types.ts";

export type PipelineResult = {
  channel_output: string;
  orchestration_result: OrchestrationResult;
};

export type E2ESolver = (result: PipelineResult, harness: RealHarness) => void | Promise<void>;

export type E2ECase = {
  name: string;
  /** 파이프라인에 보낼 입력 메시지. requires_llm=false면 무시됨. */
  input: string;
  /** 결과 판정 함수. */
  solver: E2ESolver;
  /** 인바운드 채널. 기본: "telegram" */
  provider?: ChannelProvider;
  /** 테스트 전 실행할 셋업. */
  setup?: (harness: RealHarness) => void | Promise<void>;
  /** LLM 호출 필요 여부. false면 파이프라인 실행 없이 solver만 호출. 기본: true */
  requires_llm?: boolean;
  /** Spotify Desktop 필요 여부. true면 Spotify 미가동 시 skip. */
  requires_spotify?: boolean;
};

async function run_pipeline(
  h: RealHarness,
  content: string,
  provider: ChannelProvider = "telegram",
  timeout_ms = 120_000,
): Promise<PipelineResult> {
  let captured_result: OrchestrationResult | null = null;
  const original_execute = h.orchestration.execute.bind(h.orchestration);
  h.orchestration.execute = async (req: OrchestrationRequest) => {
    const result = await original_execute(req);
    captured_result = result;
    return result;
  };

  try {
    const msg = inbound(content, { provider, channel: provider });
    await h.manager.handle_inbound_message(msg);
    const output = await h.channel.wait_for_output(timeout_ms);
    const channel_output = String(output.content || "");

    const r = captured_result as OrchestrationResult | null;
    console.log(`\n━━━ INPUT: "${content.slice(0, 80)}" ━━━`);
    console.log(`━━━ MODE: ${r?.mode || "?"} | TOOLS: ${r?.tool_calls_count ?? "?"} | STREAMED: ${r?.streamed ?? "?"} ━━━`);
    console.log(`━━━ OUTPUT (${channel_output.length}ch): ${channel_output.slice(0, 400)} ━━━\n`);

    return { channel_output, orchestration_result: captured_result! };
  } finally {
    h.orchestration.execute = original_execute;
  }
}

const EMPTY_RESULT: PipelineResult = {
  channel_output: "",
  orchestration_result: { reply: null, mode: "once", tool_calls_count: 0, streamed: false },
};

/**
 * E2E 테스트 스위트를 정의하고 실행.
 *
 * @param suite_name describe 블록 이름
 * @param cases [input, solver] 케이스 배열
 */
export function define_e2e_suite(suite_name: string, cases: E2ECase[]): void {
  const PHI4_PROMISE = is_phi4_available();
  const SPOTIFY_PROMISE = is_spotify_available();

  describe(suite_name, { sequential: true, timeout: 300_000 }, () => {
    let h: RealHarness;
    let phi4_ok = false;
    let spotify_ok = false;

    beforeAll(async () => {
      [phi4_ok, spotify_ok] = await Promise.all([PHI4_PROMISE, SPOTIFY_PROMISE]);
      if (!phi4_ok) return;
      h = await create_real_harness();
    }, 30_000);

    afterAll(async () => {
      if (h) await h.cleanup();
    });

    beforeEach(() => {
      if (h) h.channel.clear();
    });

    for (const c of cases) {
      const needs_llm = c.requires_llm !== false;

      it(c.name, async () => {
        if (!phi4_ok) {
          console.log(`SKIP: Phi-4 미가동`);
          return;
        }
        if (c.requires_spotify && !spotify_ok) {
          console.log(`SKIP: Spotify 미가동`);
          return;
        }

        if (c.setup) await c.setup(h);

        if (needs_llm) {
          const result = await run_pipeline(h, c.input, c.provider);
          await c.solver(result, h);
        } else {
          await c.solver(EMPTY_RESULT, h);
        }
      });
    }
  });
}

export { expect };
export { no_secret_leak } from "./harness.ts";
