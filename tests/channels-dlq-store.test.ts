import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteDispatchDlqStore } from "../src/channels/dlq-store.ts";

test("sqlite dlq store appends and lists outbound dead-letter records", async () => {
  const root = await mkdtemp(join(tmpdir(), "dlq-store-"));
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
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.provider, "telegram");
  assert.equal(rows[0]?.chat_id, "chat-1");
  assert.equal(rows[0]?.retry_count, 3);
  assert.equal(String(rows[0]?.metadata?.kind || ""), "agent_reply");
  assert.equal(String(store.get_path() || "").endsWith("dlq.db"), true);
});

