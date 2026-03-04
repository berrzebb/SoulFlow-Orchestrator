/** 스트림 데이터를 줄 단위로 분리하여 NDJSON 파싱을 수행하는 스트림 버퍼. */

import type { CliAdapter, AgentOutputMessage } from "./types.js";

export class NdjsonParser {
  private buffer = "";

  constructor(private readonly adapter: CliAdapter) {}

  /** 스트림 청크를 받아 파싱된 메시지 배열을 반환. */
  feed(chunk: string): AgentOutputMessage[] {
    this.buffer += chunk;
    const results: AgentOutputMessage[] = [];

    let newline_idx: number;
    while ((newline_idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newline_idx);
      this.buffer = this.buffer.slice(newline_idx + 1);

      if (!line.trim()) continue;
      const msg = this.adapter.parse_output(line);
      if (msg) push_result(results, msg);
    }

    return results;
  }

  /** 버퍼에 남은 불완전한 데이터를 플러시. */
  flush(): AgentOutputMessage[] {
    if (!this.buffer.trim()) {
      this.buffer = "";
      return [];
    }
    const msg = this.adapter.parse_output(this.buffer);
    this.buffer = "";
    if (!msg) return [];
    const out: AgentOutputMessage[] = [];
    push_result(out, msg);
    return out;
  }

  reset(): void {
    this.buffer = "";
  }
}

/** parse_output의 단일/배열 반환을 통합 처리. */
function push_result(out: AgentOutputMessage[], msg: AgentOutputMessage | AgentOutputMessage[]): void {
  if (Array.isArray(msg)) out.push(...msg);
  else out.push(msg);
}
