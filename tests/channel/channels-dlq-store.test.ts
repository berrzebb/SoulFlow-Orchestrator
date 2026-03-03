import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, describe, it, expect } from "vitest";
import { SqliteDispatchDlqStore } from "@src/channels/dlq-store.ts";

describe("channels dlq store", () => {
  let root: string;
  afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it("appends and lists outbound dead-letter records", async () => {
    root = await mkdtemp(join(tmpdir(), "dlq-store-"));
    const db = join(root, "runtime", "dlq", "dlq.db");
    const store = new SqliteDispatchDlqStore(db);

    await store.append({
      at: new Date().toISOString(),
      provider: "telegram",
      chat_id: "chat-1",
      message_id: "msg-1",
      sender_id: "assistant",
      reply_to: "",
      thread_id: "",
      retry_count: 3,
      error: "send_failed",
      content: "hello",
      metadata: { kind: "agent_reply" },
    });

    const rows = await store.list(10);
    expect(rows.length).toBe(1);
    expect(rows[0]?.provider).toBe("telegram");
    expect(rows[0]?.chat_id).toBe("chat-1");
    expect(rows[0]?.retry_count).toBe(3);
    expect(String(rows[0]?.metadata?.kind || "")).toBe("agent_reply");
    expect(String(store.get_path() || "").endsWith("dlq.db")).toBe(true);
  });
});
