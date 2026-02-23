import type { TaskState } from "../contracts.js";
import type { TaskStore } from "./task-store.js";

export class TaskRecoveryService {
  private readonly store: TaskStore;

  constructor(store: TaskStore) {
    this.store = store;
  }

  async list_resumable(): Promise<TaskState[]> {
    return this.store.list_resumable();
  }
}
