import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquire_runtime_instance_lock } from "../src/runtime/instance-lock.ts";

test("runtime instance lock prevents duplicate acquisition and releases correctly", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "runtime-lock-"));
  const first = await acquire_runtime_instance_lock({ workspace, retries: 1, retry_ms: 10 });
  assert.equal(first.acquired, true);

  const second = await acquire_runtime_instance_lock({ workspace, retries: 1, retry_ms: 10 });
  assert.equal(second.acquired, false);
  assert.equal(second.holder_pid, process.pid);

  await first.release();
  const third = await acquire_runtime_instance_lock({ workspace, retries: 1, retry_ms: 10 });
  assert.equal(third.acquired, true);
  await third.release();
});

