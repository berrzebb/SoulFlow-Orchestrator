/**
 * 페르소나 역할극 E2E 테스트: CLI 에이전트에 역할을 부여하고 대화.
 *
 * Claude Code는 --append-system-prompt 플래그로 페르소나를 주입하고,
 * Codex CLI는 stdin 프롬프트에 합쳐서 전달한다.
 * 두 에이전트가 각자의 페르소나를 유지하며 대화하는 시나리오를 검증.
 *
 * 실행: npx vitest run tests/agent/pty/e2e-persona-roleplay.test.ts
 * 환경변수:
 *   E2E_SKIP=1 — CLI 미설치 환경에서 스킵
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { LocalPty } from "@src/agent/pty/local-pty.ts";
import { AgentBus } from "@src/agent/pty/agent-bus.ts";
import { ContainerPool } from "@src/agent/pty/container-pool.ts";
import { ContainerCliAgent } from "@src/agent/pty/container-cli-agent.ts";
import { ClaudeCliAdapter, CodexCliAdapter } from "@src/agent/pty/cli-adapter.ts";
import type { PtyFactory, CliAdapter } from "@src/agent/pty/types.ts";
import { sanitize_provider_output } from "@src/channels/output-sanitizer.ts";
import { create_noop_logger } from "@helpers/harness.ts";

const SKIP = process.env.E2E_SKIP === "1";

function cli_available(cmd: string): boolean {
  try {
    execFileSync(cmd, ["--version"], { timeout: 5000, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const CLAUDE_OK = !SKIP && cli_available("claude");
const CODEX_OK = !SKIP && cli_available("codex");
const BOTH_OK = CLAUDE_OK && CODEX_OK;

const real_pty_factory: PtyFactory = (file, args, options) => {
  return new LocalPty(file, args, options);
};

function sanitize_relay(content: string | null | undefined): string {
  return sanitize_provider_output(content ?? "");
}

interface AgentHandle {
  agent: ContainerCliAgent;
  adapter: CliAdapter;
}

function create_cli_agent(cli: "claude" | "codex"): AgentHandle {
  const adapter = cli === "codex" ? new CodexCliAdapter() : new ClaudeCliAdapter();
  const logger = create_noop_logger();
  const pool = new ContainerPool({
    pty_factory: real_pty_factory,
    adapter,
    default_env: {},
    cwd: process.cwd(),
    max_idle_ms: 0,
    logger,
  });
  const bus = new AgentBus({
    pool,
    adapter,
    logger,
  });
  const agent = new ContainerCliAgent({
    id: `persona-${cli}`,
    bus,
    adapter,
    logger,
    default_env: {},
  });
  return { agent, adapter };
}

// ── Claude 단독 페르소나 테스트 ──

describe.skipIf(!CLAUDE_OK)("Persona E2E: Claude 페르소나 부여", () => {
  const handles: AgentHandle[] = [];
  afterEach(() => { handles.forEach(h => h.agent.stop()); handles.length = 0; });

  it("해적 페르소나를 부여하면 해적 말투로 응답한다", async () => {
    const claude = create_cli_agent("claude");
    handles.push(claude);

    const result = await claude.agent.run({
      task: "Introduce yourself briefly.",
      task_id: `persona-pirate-${Date.now()}`,
      system_prompt: "You are a pirate captain named Captain Blackbeard. Always speak like a pirate. Use words like 'arr', 'matey', 'ye', 'treasure'. Never break character.",
    });

    console.log("\n=== Pirate Persona ===");
    console.log("content:", result.content?.substring(0, 300));

    expect(result.finish_reason).toBe("stop");
    expect(result.content).toBeTruthy();
    // 해적 관련 키워드가 하나 이상 포함되어야 함
    const lower = result.content!.toLowerCase();
    const pirate_words = ["arr", "matey", "ye", "treasure", "captain", "blackbeard", "ship", "sea", "ahoy"];
    const has_pirate = pirate_words.some(w => lower.includes(w));
    expect(has_pirate).toBe(true);
  }, 60_000);

  it("과학자 페르소나를 부여하면 과학 용어를 사용한다", async () => {
    const claude = create_cli_agent("claude");
    handles.push(claude);

    const result = await claude.agent.run({
      task: "Explain why the sky is blue in exactly 2 sentences.",
      task_id: `persona-scientist-${Date.now()}`,
      system_prompt: "You are Dr. Photon, a quantum physicist. Always explain things using scientific terminology. Mention wavelengths, scattering, or molecular interactions when relevant.",
    });

    console.log("\n=== Scientist Persona ===");
    console.log("content:", result.content?.substring(0, 300));

    expect(result.finish_reason).toBe("stop");
    expect(result.content).toBeTruthy();
    const lower = result.content!.toLowerCase();
    const science_words = ["scatter", "wavelength", "light", "molecule", "rayleigh", "photon", "spectrum"];
    const has_science = science_words.some(w => lower.includes(w));
    expect(has_science).toBe(true);
  }, 60_000);
});

// ── Cross-CLI 역할극 테스트 ──

describe.skipIf(!BOTH_OK)("Persona E2E: Claude ↔ Codex 역할극 대화", () => {
  const handles: AgentHandle[] = [];
  afterEach(() => { handles.forEach(h => h.agent.stop()); handles.length = 0; });

  it("의사와 환자: 진단 대화", async () => {
    const doctor = create_cli_agent("claude");
    const patient = create_cli_agent("codex");
    handles.push(doctor, patient);

    // Turn 1: 환자가 증상을 호소
    const turn1 = await patient.agent.run({
      task: "You visit the doctor. Describe your symptoms: you have a headache and feel dizzy. Keep it to 2 sentences.",
      task_id: `rp-patient-${Date.now()}`,
      system_prompt: "You are a patient named Alex visiting a doctor. Describe your symptoms naturally. Stay in character.",
    });

    console.log("\n=== Turn 1: Patient describes symptoms ===");
    console.log("content:", turn1.content?.substring(0, 300));
    expect(turn1.finish_reason).toBe("stop");
    expect(turn1.content).toBeTruthy();

    // Turn 2: 의사가 진단 (sanitize 적용)
    const relay_symptoms = sanitize_relay(turn1.content);
    const turn2 = await doctor.agent.run({
      task: `A patient says: "${relay_symptoms}". Ask one follow-up question and give a brief preliminary assessment.`,
      task_id: `rp-doctor-${Date.now()}`,
      system_prompt: "You are Dr. Kim, an experienced physician. Ask relevant follow-up questions and provide medical assessments. Stay in character as a doctor.",
    });

    console.log("\n=== Turn 2: Doctor responds ===");
    console.log("content:", turn2.content?.substring(0, 300));
    expect(turn2.finish_reason).toBe("stop");
    expect(turn2.content).toBeTruthy();
    // 의사 관련 키워드
    const lower = turn2.content!.toLowerCase();
    const medical_words = ["symptom", "headache", "dizz", "recommend", "suggest", "exam", "test", "condition", "blood", "pressure", "question", "history"];
    expect(medical_words.some(w => lower.includes(w))).toBe(true);

    // Turn 3: 환자가 후속 답변
    const relay_doctor = sanitize_relay(turn2.content);
    const turn3 = await patient.agent.run({
      task: `The doctor says: "${relay_doctor}". Answer the doctor's question and ask when you can expect to feel better.`,
      task_id: `rp-patient2-${Date.now()}`,
      system_prompt: "You are a patient named Alex. Answer the doctor's questions honestly and ask about recovery. Stay in character.",
    });

    console.log("\n=== Turn 3: Patient responds ===");
    console.log("content:", turn3.content?.substring(0, 300));
    expect(turn3.finish_reason).toBe("stop");
    expect(turn3.content).toBeTruthy();
  }, 180_000);

  it("면접관과 지원자: 기술 면접", async () => {
    const interviewer = create_cli_agent("claude");
    const candidate = create_cli_agent("codex");
    handles.push(interviewer, candidate);

    // Turn 1: 면접관이 질문
    const turn1 = await interviewer.agent.run({
      task: "Start a technical interview. Ask one coding question about data structures.",
      task_id: `rp-interviewer-${Date.now()}`,
      system_prompt: "You are a senior software engineer conducting a technical interview. Ask clear, specific coding questions. Be professional.",
    });

    console.log("\n=== Turn 1: Interviewer asks ===");
    console.log("content:", turn1.content?.substring(0, 300));
    expect(turn1.finish_reason).toBe("stop");
    expect(turn1.content).toBeTruthy();

    // Turn 2: 지원자가 답변
    const relay_question = sanitize_relay(turn1.content);
    const turn2 = await candidate.agent.run({
      task: `The interviewer asks: "${relay_question}". Answer the question concisely with a code example if relevant.`,
      task_id: `rp-candidate-${Date.now()}`,
      system_prompt: "You are a software engineer candidate in a job interview. Give clear, technically accurate answers. Show your knowledge.",
    });

    console.log("\n=== Turn 2: Candidate answers ===");
    console.log("content:", turn2.content?.substring(0, 400));
    expect(turn2.finish_reason).toBe("stop");
    expect(turn2.content).toBeTruthy();

    // Turn 3: 면접관이 평가
    const relay_answer = sanitize_relay(turn2.content);
    const turn3 = await interviewer.agent.run({
      task: `The candidate answered: "${relay_answer}". Evaluate their answer. Say PASS or FAIL and explain briefly why.`,
      task_id: `rp-interviewer2-${Date.now()}`,
      system_prompt: "You are a senior software engineer evaluating interview answers. Be fair but rigorous. Give PASS or FAIL with reasoning.",
    });

    console.log("\n=== Turn 3: Interviewer evaluates ===");
    console.log("content:", turn3.content?.substring(0, 300));
    expect(turn3.finish_reason).toBe("stop");
    expect(turn3.content).toBeTruthy();
    // PASS 또는 FAIL 포함
    const upper = turn3.content!.toUpperCase();
    expect(upper.includes("PASS") || upper.includes("FAIL")).toBe(true);
  }, 180_000);

  it("선생님과 학생: 역사 수업", async () => {
    const teacher = create_cli_agent("claude");
    const student = create_cli_agent("codex");
    handles.push(teacher, student);

    // Turn 1: 선생님이 질문
    const turn1 = await teacher.agent.run({
      task: "Ask a history question about World War II. Keep it simple and specific.",
      task_id: `rp-teacher-${Date.now()}`,
      system_prompt: "You are Professor Park, a history teacher. Ask educational questions and provide feedback. Be encouraging.",
    });

    console.log("\n=== Turn 1: Teacher asks ===");
    console.log("content:", turn1.content?.substring(0, 300));
    expect(turn1.finish_reason).toBe("stop");

    // Turn 2: 학생이 답변
    const relay_q = sanitize_relay(turn1.content);
    const turn2 = await student.agent.run({
      task: `Your history teacher asks: "${relay_q}". Answer the question as a diligent student.`,
      task_id: `rp-student-${Date.now()}`,
      system_prompt: "You are a high school student who enjoys history. Answer questions earnestly. You may not know everything perfectly.",
    });

    console.log("\n=== Turn 2: Student answers ===");
    console.log("content:", turn2.content?.substring(0, 300));
    expect(turn2.finish_reason).toBe("stop");

    // Turn 3: 선생님이 피드백
    const relay_a = sanitize_relay(turn2.content);
    const turn3 = await teacher.agent.run({
      task: `Your student answered: "${relay_a}". Grade their answer as A, B, C, D, or F. Give brief feedback.`,
      task_id: `rp-teacher2-${Date.now()}`,
      system_prompt: "You are Professor Park. Grade student answers fairly. Be encouraging even if the answer is wrong. Give a letter grade (A-F).",
    });

    console.log("\n=== Turn 3: Teacher grades ===");
    console.log("content:", turn3.content?.substring(0, 300));
    expect(turn3.finish_reason).toBe("stop");
    // A~F 학점 포함
    expect(turn3.content).toMatch(/\b[ABCDF]\b/);
  }, 180_000);
});
