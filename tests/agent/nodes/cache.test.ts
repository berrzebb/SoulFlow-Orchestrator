/** Cache 노드 핸들러 테스트
 *
 * 목표: cache_handler를 통한 TTL 기반 캐싱 검증
 *       - execute: cache hit/miss 처리
 *       - operation: get_or_set vs invalidate
 *       - template resolution: cache_key 변수 치환
 *       - TTL: 만료 시간 관리
 *       - validation: cache_key, ttl_ms 필수성
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cache_handler } from "@src/agent/nodes/cache.js";
import type { CacheNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";

/* ── Mock Data ── */

const createMockCacheNode = (overrides?: Partial<CacheNodeDefinition>): CacheNodeDefinition => ({
  node_id: "cache-1",
  label: "Test Cache",
  node_type: "cache",
  cache_key: "test-key",
  ttl_ms: 5000,
  operation: "get_or_set",
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    previous_output: {},
    request_id: "req-123",
    result: { data: "test" },
    count: 42,
  },
  ...overrides,
});

/* ── Tests ── */

describe("Cache Node Handler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(cache_handler.node_type).toBe("cache");
    });

    it("should have output_schema with value, hit, cache_key", () => {
      const schema = cache_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("value");
      expect(fields).toContain("hit");
      expect(fields).toContain("cache_key");
    });

    it("should have input_schema with value", () => {
      const schema = cache_handler.input_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("value");
    });

    it("should have create_default with get_or_set operation", () => {
      const defaultNode = cache_handler.create_default?.();
      expect(defaultNode?.cache_key).toBe("");
      expect(defaultNode?.ttl_ms).toBe(300_000);
      expect(defaultNode?.operation).toBe("get_or_set");
    });

    it("should have icon and color metadata", () => {
      expect(cache_handler.icon).toBeDefined();
      expect(cache_handler.color).toBeDefined();
    });
  });

  describe("execute — cache miss (first access)", () => {
    it("should return miss when key not in cache", async () => {
      const node = createMockCacheNode({
        cache_key: "new-key",
        depends_on: ["result"],
      });
      const ctx = createMockContext();

      const result = await cache_handler.execute(node, ctx);

      expect(result.output.hit).toBe(false);
      expect(result.output.cache_key).toBe("new-key");
      expect(result.output.value).toEqual({ data: "test" });
    });

    it("should store value with TTL on miss", async () => {
      const node = createMockCacheNode({
        cache_key: "store-test",
        ttl_ms: 10000,
        depends_on: ["result"],
      });
      const ctx = createMockContext();

      // First access - miss
      const result1 = await cache_handler.execute(node, ctx);
      expect(result1.output.hit).toBe(false);

      // Second access immediately - should hit
      const result2 = await cache_handler.execute(node, ctx);
      expect(result2.output.hit).toBe(true);
      expect(result2.output.value).toEqual({ data: "test" });
    });

    it("should use depends_on for value source", async () => {
      const node = createMockCacheNode({
        cache_key: "dep-test",
        depends_on: ["count"],
      });
      const ctx = createMockContext();

      const result = await cache_handler.execute(node, ctx);

      expect(result.output.value).toBe(42);
    });

    it("should handle missing depends_on", async () => {
      const node = createMockCacheNode({
        cache_key: "no-deps",
        depends_on: [],
      });
      const ctx = createMockContext();

      const result = await cache_handler.execute(node, ctx);

      expect(result.output.value).toBeNull();
    });
  });

  describe("execute — cache hit", () => {
    it("should return hit when key in cache and not expired", async () => {
      const node = createMockCacheNode({
        cache_key: "persistent-key",
        ttl_ms: 10000,
        depends_on: ["result"],
      });
      const ctx = createMockContext();

      // First access - populate cache
      const result1 = await cache_handler.execute(node, ctx);
      expect(result1.output.hit).toBe(false);

      // Advance time by 5 seconds (still within TTL of 10 seconds)
      vi.advanceTimersByTime(5000);

      // Second access - should hit
      const result2 = await cache_handler.execute(node, ctx);
      expect(result2.output.hit).toBe(true);
      expect(result2.output.value).toEqual({ data: "test" });
    });

    it("should return miss when cache expires", async () => {
      const node = createMockCacheNode({
        cache_key: "expiring-key",
        ttl_ms: 5000,
        depends_on: ["result"],
      });
      const ctx = createMockContext();

      // First access - populate with TTL 5s
      const result1 = await cache_handler.execute(node, ctx);
      expect(result1.output.hit).toBe(false);

      // Advance time by 6 seconds (past TTL)
      vi.advanceTimersByTime(6000);

      // Second access - should miss and refresh
      const result2 = await cache_handler.execute(node, ctx);
      expect(result2.output.hit).toBe(false);
    });

    it("should preserve cached value type", async () => {
      const node = createMockCacheNode({
        cache_key: "type-test",
        ttl_ms: 10000,
        depends_on: ["result"],
      });
      const ctx = createMockContext();

      // Store object
      await cache_handler.execute(node, ctx);

      // Retrieve and check type
      const result = await cache_handler.execute(node, ctx);
      expect(result.output.hit).toBe(true);
      expect(typeof result.output.value).toBe("object");
    });

    it("should return exact cached value on hit", async () => {
      const node = createMockCacheNode({
        cache_key: "exact-test",
        depends_on: ["count"],
      });
      const ctx = createMockContext();

      await cache_handler.execute(node, ctx);
      const result = await cache_handler.execute(node, ctx);

      expect(result.output.value).toBe(42);
    });
  });

  describe("execute — template resolution", () => {
    it("should resolve cache_key with memory variables", async () => {
      const node = createMockCacheNode({
        cache_key: "cache-{{memory.request_id}}",
        ttl_ms: 10000,
        depends_on: ["result"],
      });
      const ctx = createMockContext();

      const result = await cache_handler.execute(node, ctx);

      expect(result.output.cache_key).toBe("cache-req-123");
    });

    it("should handle cache hit with resolved key", async () => {
      const node = createMockCacheNode({
        cache_key: "user-{{memory.user_id}}",
        ttl_ms: 10000,
        depends_on: ["result"],
      });
      const ctx = createMockContext();

      // First access
      const result1 = await cache_handler.execute(node, ctx);
      expect(result1.output.hit).toBe(false);

      // Second access with same template resolution
      const result2 = await cache_handler.execute(node, ctx);
      expect(result2.output.hit).toBe(true);
      expect(result2.output.cache_key).toBe("user-user-1");
    });

    it("should separate cache by resolved key", async () => {
      const node1 = createMockCacheNode({
        cache_key: "item-{{memory.request_id}}",
        ttl_ms: 10000,
        depends_on: ["count"],
      });
      const node2 = createMockCacheNode({
        cache_key: "item-other-id",
        ttl_ms: 10000,
        depends_on: ["result"],
      });
      const ctx = createMockContext();

      // Access different keys
      const result1 = await cache_handler.execute(node1, ctx);
      expect(result1.output.value).toBe(42);

      const result2 = await cache_handler.execute(node2, ctx);
      expect(result2.output.value).toEqual({ data: "test" });

      // Both should hit independently
      const hit1 = await cache_handler.execute(node1, ctx);
      expect(hit1.output.hit).toBe(true);
      expect(hit1.output.value).toBe(42);

      const hit2 = await cache_handler.execute(node2, ctx);
      expect(hit2.output.hit).toBe(true);
      expect(hit2.output.value).toEqual({ data: "test" });
    });
  });

  describe("execute — invalidate operation", () => {
    it("should invalidate cache for key", async () => {
      const node = createMockCacheNode({
        cache_key: "to-invalidate",
        ttl_ms: 10000,
        depends_on: ["result"],
      });
      const ctx = createMockContext();

      // Populate cache
      const result1 = await cache_handler.execute(node, ctx);
      expect(result1.output.hit).toBe(false);

      // Verify it's cached
      const result2 = await cache_handler.execute(node, ctx);
      expect(result2.output.hit).toBe(true);

      // Invalidate
      const invalidate_node = createMockCacheNode({
        cache_key: "to-invalidate",
        operation: "invalidate",
      });
      const invalidate_result = await cache_handler.execute(invalidate_node, ctx);
      expect(invalidate_result.output.hit).toBe(false);
      expect(invalidate_result.output.value).toBeNull();

      // Next access should miss
      const result3 = await cache_handler.execute(node, ctx);
      expect(result3.output.hit).toBe(false);
    });

    it("should return miss on invalidate", async () => {
      const node = createMockCacheNode({
        cache_key: "nonexistent",
        operation: "invalidate",
      });
      const ctx = createMockContext();

      const result = await cache_handler.execute(node, ctx);

      expect(result.output.hit).toBe(false);
      expect(result.output.value).toBeNull();
      expect(result.output.cache_key).toBe("nonexistent");
    });
  });

  describe("execute — TTL handling", () => {
    it("should respect default TTL of 300s", async () => {
      const node = createMockCacheNode({
        cache_key: "default-ttl",
        ttl_ms: undefined,
        depends_on: ["result"],
      });
      const ctx = createMockContext();

      await cache_handler.execute(node, ctx);

      // Advance 200s (still within default 300s)
      vi.advanceTimersByTime(200_000);
      const result = await cache_handler.execute(node, ctx);
      expect(result.output.hit).toBe(true);
    });

    it("should handle zero TTL", async () => {
      const node = createMockCacheNode({
        cache_key: "zero-ttl",
        ttl_ms: 0,
        depends_on: ["result"],
      });
      const ctx = createMockContext();

      const result1 = await cache_handler.execute(node, ctx);
      expect(result1.output.hit).toBe(false);

      // Even immediate access should miss (0 TTL means expired immediately)
      const result2 = await cache_handler.execute(node, ctx);
      expect(result2.output.hit).toBe(false);
    });

    it("should handle negative TTL as zero", async () => {
      const node = createMockCacheNode({
        cache_key: "negative-ttl",
        ttl_ms: -1000,
        depends_on: ["result"],
      });
      const ctx = createMockContext();

      const result1 = await cache_handler.execute(node, ctx);
      expect(result1.output.hit).toBe(false);

      // Next access should miss
      const result2 = await cache_handler.execute(node, ctx);
      expect(result2.output.hit).toBe(false);
    });

    it("should handle large TTL", async () => {
      const node = createMockCacheNode({
        cache_key: "long-ttl",
        ttl_ms: 86_400_000, // 24 hours
        depends_on: ["result"],
      });
      const ctx = createMockContext();

      await cache_handler.execute(node, ctx);

      // Advance 12 hours
      vi.advanceTimersByTime(43_200_000);

      const result = await cache_handler.execute(node, ctx);
      expect(result.output.hit).toBe(true);
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid configuration", () => {
      const node = createMockCacheNode({
        cache_key: "valid-key",
        ttl_ms: 5000,
      });
      const ctx = createMockContext();

      const result = cache_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when cache_key missing", () => {
      const node = createMockCacheNode({
        cache_key: "",
      });
      const ctx = createMockContext();

      const result = cache_handler.test(node, ctx);

      expect(result.warnings).toContain("cache_key is required");
    });

    it("should warn when cache_key is whitespace only", () => {
      const node = createMockCacheNode({
        cache_key: "   ",
      });
      const ctx = createMockContext();

      const result = cache_handler.test(node, ctx);

      expect(result.warnings).toContain("cache_key is required");
    });

    it("should warn when ttl_ms not positive", () => {
      const node = createMockCacheNode({
        cache_key: "test",
        ttl_ms: 0,
      });
      const ctx = createMockContext();

      const result = cache_handler.test(node, ctx);

      expect(result.warnings).toContain("ttl_ms should be positive");
    });

    it("should warn when ttl_ms negative", () => {
      const node = createMockCacheNode({
        cache_key: "test",
        ttl_ms: -1000,
      });
      const ctx = createMockContext();

      const result = cache_handler.test(node, ctx);

      expect(result.warnings).toContain("ttl_ms should be positive");
    });

    it("should include preview with resolved key", () => {
      const node = createMockCacheNode({
        cache_key: "user-{{memory.user_id}}",
        ttl_ms: 5000,
      });
      const ctx = createMockContext();

      const result = cache_handler.test(node, ctx);

      expect(result.preview.cache_key).toBe("user-user-1");
      expect(result.preview.ttl_ms).toBe(5000);
      expect(result.preview.operation).toBe("get_or_set");
    });

    it("should show operation in preview", () => {
      const node = createMockCacheNode({
        cache_key: "test",
        operation: "invalidate",
      });
      const ctx = createMockContext();

      const result = cache_handler.test(node, ctx);

      expect(result.preview.operation).toBe("invalidate");
    });
  });

  describe("integration scenarios", () => {
    it("should cache API response", async () => {
      const node = createMockCacheNode({
        cache_key: "api-result",
        ttl_ms: 30000,
        depends_on: ["result"],
      });
      const ctx = createMockContext();

      // First call - cache miss
      const result1 = await cache_handler.execute(node, ctx);
      expect(result1.output.hit).toBe(false);
      expect(result1.output.value).toEqual({ data: "test" });

      // Second call - cache hit
      const result2 = await cache_handler.execute(node, ctx);
      expect(result2.output.hit).toBe(true);
    });

    it("should handle per-user cache keys", async () => {
      const node1 = createMockCacheNode({
        cache_key: "user-{{memory.user_id}}-settings",
        ttl_ms: 60000,
        depends_on: ["result"],
      });

      const node2 = createMockCacheNode({
        cache_key: "user-other-settings",
        ttl_ms: 60000,
        depends_on: ["count"],
      });

      const ctx = createMockContext();

      // Different users get different cache entries
      const result1 = await cache_handler.execute(node1, ctx);
      expect(result1.output.cache_key).toBe("user-user-1-settings");

      const result2 = await cache_handler.execute(node2, ctx);
      expect(result2.output.cache_key).toBe("user-other-settings");

      // Check both are cached
      const hit1 = await cache_handler.execute(node1, ctx);
      expect(hit1.output.hit).toBe(true);

      const hit2 = await cache_handler.execute(node2, ctx);
      expect(hit2.output.hit).toBe(true);
    });

    it("should invalidate and refresh cache", async () => {
      const get_node = createMockCacheNode({
        cache_key: "refreshable",
        ttl_ms: 60000,
        depends_on: ["result"],
      });

      const invalidate_node = createMockCacheNode({
        cache_key: "refreshable",
        operation: "invalidate",
      });

      const ctx = createMockContext();

      // Get and cache
      const result1 = await cache_handler.execute(get_node, ctx);
      expect(result1.output.hit).toBe(false);

      // Verify cached
      const result2 = await cache_handler.execute(get_node, ctx);
      expect(result2.output.hit).toBe(true);

      // Invalidate
      await cache_handler.execute(invalidate_node, ctx);

      // Next get should refresh
      const result3 = await cache_handler.execute(get_node, ctx);
      expect(result3.output.hit).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle empty cache_key", async () => {
      const node = createMockCacheNode({
        cache_key: "",
        depends_on: ["result"],
      });
      const ctx = createMockContext();

      const result = await cache_handler.execute(node, ctx);

      expect(result.output.cache_key).toBe("");
    });

    it("should handle special characters in cache_key", async () => {
      const node = createMockCacheNode({
        cache_key: "user:123:@action",
        depends_on: ["result"],
      });
      const ctx = createMockContext();

      const result = await cache_handler.execute(node, ctx);

      expect(result.output.cache_key).toBe("user:123:@action");
    });

    it("should handle null value in depends_on", async () => {
      const node = createMockCacheNode({
        cache_key: "null-test",
        depends_on: ["nonexistent"],
      });
      const ctx = createMockContext();

      const result = await cache_handler.execute(node, ctx);

      expect(result.output.value).toBeUndefined();
    });

    it("should handle multiple accesses at exact TTL boundary", async () => {
      const node = createMockCacheNode({
        cache_key: "boundary-test",
        ttl_ms: 5000,
        depends_on: ["result"],
      });
      const ctx = createMockContext();

      // Populate
      await cache_handler.execute(node, ctx);

      // Access at exactly 5000ms (boundary)
      vi.advanceTimersByTime(5000);
      const result = await cache_handler.execute(node, ctx);

      // Should miss because expires_at = now + ttl, so now >= expires_at
      expect(result.output.hit).toBe(false);
    });
  });
});
