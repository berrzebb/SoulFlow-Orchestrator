import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TaskState } from "../contracts.js";
import { file_exists } from "../utils/common.js";

type TaskStoreData = {
  version: number;
  tasks: Record<string, TaskState>;
};

function default_data(): TaskStoreData {
  return { version: 1, tasks: {} };
}

export class TaskStore {
  private readonly store_path: string;
  private cache: TaskStoreData | null = null;

  constructor(store_path: string) {
    this.store_path = store_path;
  }

  private async load(): Promise<TaskStoreData> {
    if (this.cache) return this.cache;
    if (!(await file_exists(this.store_path))) {
      this.cache = default_data();
      return this.cache;
    }
    try {
      const raw = await readFile(this.store_path, "utf-8");
      const parsed = JSON.parse(raw) as TaskStoreData;
      this.cache = {
        version: Number(parsed.version || 1),
        tasks: parsed.tasks || {},
      };
      return this.cache;
    } catch {
      this.cache = default_data();
      return this.cache;
    }
  }

  private async save(): Promise<void> {
    const data = await this.load();
    await mkdir(dirname(this.store_path), { recursive: true });
    await writeFile(this.store_path, JSON.stringify(data, null, 2), "utf-8");
  }

  async upsert(task: TaskState): Promise<void> {
    const data = await this.load();
    data.tasks[task.taskId] = { ...task, memory: { ...(task.memory || {}) } };
    await this.save();
  }

  async get(task_id: string): Promise<TaskState | null> {
    const data = await this.load();
    const v = data.tasks[task_id];
    return v ? { ...v, memory: { ...(v.memory || {}) } } : null;
  }

  async list(): Promise<TaskState[]> {
    const data = await this.load();
    return Object.values(data.tasks).map((v) => ({ ...v, memory: { ...(v.memory || {}) } }));
  }

  async list_resumable(): Promise<TaskState[]> {
    const rows = await this.list();
    return rows.filter((t) => ["running", "waiting_approval", "max_turns_reached"].includes(t.status));
  }
}
