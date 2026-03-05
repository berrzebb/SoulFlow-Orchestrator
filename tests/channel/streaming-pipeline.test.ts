import { describe, it, expect, vi, beforeEach } from "vitest";
import { StreamBuffer } from "@src/channels/stream-buffer.js";
import { sanitize_stream_chunk } from "@src/channels/output-sanitizer.js";
import { create_stream_handler, flush_remaining } from "@src/orchestration/agent-hooks-builder.js";

/** create_stream_handler의 config 기본값. */
const DEFAULT_CONFIG = { enabled: true, interval_ms: 0, min_chars: 1 };

describe("sanitize_stream_chunk — 절단 없음", () => {
  it("4000자 이상 콘텐츠를 절단하지 않는다", () => {
    const long = "이것은 한글 텍스트입니다.".repeat(300);
    const result = sanitize_stream_chunk(long);
    expect(result.length).toBe(long.length);
  });

  it("노이즈 라인만 제거하고 나머지는 보존한다", () => {
    const input = [
      "첫 번째 유효 라인",
      "OpenAI Codex v1.0",
      "두 번째 유효 라인",
      '"tool_calls": [',
      "세 번째 유효 라인",
    ].join("\n");
    const result = sanitize_stream_chunk(input);
    expect(result).toBe("첫 번째 유효 라인\n두 번째 유효 라인\n세 번째 유효 라인");
  });

  it("ANSI 코드 + 시크릿 참조를 제거한다", () => {
    const input = "\x1B[32m결과\x1B[0m: key={{secret:API_KEY}}";
    const result = sanitize_stream_chunk(input);
    expect(result).not.toContain("\x1B[");
    expect(result).toContain("[REDACTED:SECRET_REF]");
  });

  it("빈 입력은 빈 문자열을 반환한다", () => {
    expect(sanitize_stream_chunk("")).toBe("");
    expect(sanitize_stream_chunk("   ")).toBe("");
  });
});

describe("create_stream_handler — 버퍼 통합", () => {
  let buffer: StreamBuffer;
  let chunks: string[];
  let on_stream: (chunk: string) => void;

  beforeEach(() => {
    buffer = new StreamBuffer();
    chunks = [];
    on_stream = (chunk: string) => { chunks.push(chunk); };
  });

  it("비활성화 시 undefined를 반환한다", () => {
    const handler = create_stream_handler({ enabled: false, interval_ms: 0, min_chars: 1 }, buffer, on_stream);
    expect(handler).toBeUndefined();
  });

  it("on_stream 없으면 undefined를 반환한다", () => {
    const handler = create_stream_handler(DEFAULT_CONFIG, buffer);
    expect(handler).toBeUndefined();
  });

  it("청크를 새니타이즈 후 버퍼에 누적하고 on_stream을 호출한다", async () => {
    const handler = create_stream_handler(DEFAULT_CONFIG, buffer, on_stream)!;
    expect(handler).toBeDefined();

    await handler("hello world");
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe("hello world");
  });

  it("노이즈 청크는 on_stream에 전달되지 않는다", async () => {
    const handler = create_stream_handler(DEFAULT_CONFIG, buffer, on_stream)!;
    await handler("OpenAI Codex v1.0");
    expect(chunks.length).toBe(0);
  });

  it("긴 청크를 절단하지 않는다", async () => {
    const handler = create_stream_handler(DEFAULT_CONFIG, buffer, on_stream)!;
    const long_text = "x".repeat(2000);
    await handler(long_text);
    expect(chunks.length).toBe(1);
    expect(chunks[0].length).toBe(2000);
  });

  it("flush_remaining이 버퍼 잔여 콘텐츠를 전달한다", async () => {
    // min_chars를 높게 설정해서 자동 플러시를 방지
    const handler = create_stream_handler(
      { enabled: true, interval_ms: 999_999, min_chars: 999_999 },
      buffer, on_stream,
    )!;

    await handler("buffered content");
    expect(chunks.length).toBe(0); // should_flush 조건 미충족

    flush_remaining(buffer, on_stream);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe("buffered content");
  });
});

describe("StreamBuffer — delta 누적 시뮬레이션", () => {
  it("진행형 스트림 델타들이 올바르게 누적된다", () => {
    const buffer = new StreamBuffer();
    const accumulated: string[] = [];

    // 에이전트가 토큰 단위로 스트림하는 시뮬레이션
    const deltas = ["안녕", "하세요. ", "오늘 ", "날씨가 ", "좋습니다."];
    for (const d of deltas) {
      buffer.append(d);
    }

    const flushed = buffer.flush();
    expect(flushed).toBeTruthy();
    // 모든 델타가 포함되어야 함
    expect(buffer.get_full_content()).toContain("안녕");
    expect(buffer.get_full_content()).toContain("좋습니다.");
  });

  it("오버래핑 청크에서 중복 없이 delta만 추출한다", () => {
    const buffer = new StreamBuffer();
    buffer.append("The quick brown fox");
    buffer.append("brown fox jumps over");
    // "brown fox" 오버랩 감지 → " jumps over" (단어 경계 공백 보존)
    expect(buffer.get_full_content()).toBe("The quick brown fox jumps over");
  });

  it("전체 중복 청크를 무시한다", () => {
    const buffer = new StreamBuffer();
    buffer.append("same content");
    buffer.append("same content");
    buffer.append("same content");
    expect(buffer.get_full_content()).toBe("same content");
  });

  it("플러시 후 새 delta가 정상 누적된다", () => {
    const buffer = new StreamBuffer();
    buffer.append("first chunk");
    expect(buffer.flush()).toBe("first chunk");

    buffer.append("second chunk");
    expect(buffer.flush()).toBe("second chunk");

    expect(buffer.get_full_content()).toBe("first chunksecond chunk");
    expect(buffer.get_flush_count()).toBe(2);
  });
});

describe("스트리밍 파이프라인 end-to-end 시뮬레이션", () => {
  it("on_stream → accumulated → 플랫폼 전달까지 콘텐츠가 보존된다", async () => {
    const buffer = new StreamBuffer();
    let accumulated = "";
    const stream_edits: string[] = [];

    const on_stream = (chunk: string) => {
      if (accumulated && !accumulated.endsWith("\n") && !chunk.startsWith("\n")) {
        accumulated += "\n";
      }
      accumulated += chunk;
      stream_edits.push(accumulated);
    };

    const handler = create_stream_handler(DEFAULT_CONFIG, buffer, on_stream)!;

    // 여러 청크 스트리밍
    await handler("첫 번째 문장입니다.");
    await handler("두 번째 문장입니다.");
    await handler("세 번째 문장입니다.");

    // 각 업데이트마다 누적 콘텐츠가 증가
    expect(stream_edits.length).toBe(3);
    expect(stream_edits[0]).toContain("첫 번째");
    expect(stream_edits[2]).toContain("첫 번째");
    expect(stream_edits[2]).toContain("세 번째");

    // 최종 accumulated에 모든 콘텐츠 포함
    expect(accumulated).toContain("첫 번째 문장입니다.");
    expect(accumulated).toContain("두 번째 문장입니다.");
    expect(accumulated).toContain("세 번째 문장입니다.");
  });

  it("도구 이벤트가 스트림에 올바르게 섞인다 (inline 모드)", async () => {
    const buffer = new StreamBuffer();
    let accumulated = "";

    const on_stream = (chunk: string) => {
      if (accumulated && !accumulated.endsWith("\n") && !chunk.startsWith("\n")) {
        accumulated += "\n";
      }
      accumulated += chunk;
    };

    const handler = create_stream_handler(DEFAULT_CONFIG, buffer, on_stream)!;

    // 텍스트 청크
    await handler("파일을 읽겠습니다.");

    // 도구 이벤트 직접 주입 (agent-hooks-builder의 on_event가 하는 것)
    buffer.append("\n▸ `read_file`");
    const flushed = buffer.flush();
    if (flushed) on_stream(flushed);

    // 도구 결과 후 텍스트 청크
    await handler("파일 내용을 분석했습니다.");

    expect(accumulated).toContain("파일을 읽겠습니다.");
    expect(accumulated).toContain("▸ `read_file`");
    expect(accumulated).toContain("파일 내용을 분석했습니다.");
  });

  it("on_stream 콜백 에러가 파이프라인을 중단하지 않는다", async () => {
    const buffer = new StreamBuffer();
    let call_count = 0;
    const on_stream = (_chunk: string) => {
      call_count++;
      if (call_count === 1) throw new Error("stream callback failed");
    };

    const handler = create_stream_handler(DEFAULT_CONFIG, buffer, on_stream)!;

    // 첫 번째 청크에서 에러 발생해도 핸들러 자체는 에러를 전파하지 않아야 함
    await handler("first");
    // create_stream_handler 내부에서 try-catch로 on_stream 에러를 잡음
    // 두 번째 청크는 정상 처리
    await handler("second");
    expect(call_count).toBe(2);
  });

  it("delta 구분자가 올바르게 추가된다", () => {
    let accumulated = "";
    const chunks = ["hello", "world", "\nnewline start"];

    for (const chunk of chunks) {
      if (accumulated && !accumulated.endsWith("\n") && !chunk.startsWith("\n")) {
        accumulated += "\n";
      }
      accumulated += chunk;
    }

    // "hello" + "\n" + "world" + "\n" + "newline start"
    expect(accumulated).toBe("hello\nworld\nnewline start");
  });
});
