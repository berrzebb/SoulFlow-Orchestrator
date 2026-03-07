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
