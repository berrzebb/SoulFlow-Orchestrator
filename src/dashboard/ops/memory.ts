/** Dashboard memory ops. */

import type { DashboardMemoryOps } from "../service.js";
import type { MemoryStoreLike } from "../../agent/memory.types.js";

export function create_memory_ops(memory_store: MemoryStoreLike): DashboardMemoryOps {
  return {
    read_longterm: () => memory_store.read_longterm(),
    write_longterm: (content) => memory_store.write_longterm(content),
    list_daily: () => memory_store.list_daily(),
    read_daily: (day) => memory_store.read_daily(day),
    write_daily: (content, day) => memory_store.write_daily(content, day),
  };
}

/**
 * per-user MemoryStore 캐시 기반 스코프드 memory ops 팩토리.
 * 동일 user_content 경로에 대해 MemoryStore를 재사용.
 */
export class ScopedMemoryOpsCache {
  private readonly cache = new Map<string, DashboardMemoryOps>();
  private readonly store_factory: (root: string) => MemoryStoreLike;

  constructor(store_factory: (root: string) => MemoryStoreLike) {
    this.store_factory = store_factory;
  }

  get(user_content: string): DashboardMemoryOps {
    let ops = this.cache.get(user_content);
    if (!ops) {
      ops = create_memory_ops(this.store_factory(user_content));
      this.cache.set(user_content, ops);
    }
    return ops;
  }

  clear(): void { this.cache.clear(); }
}
