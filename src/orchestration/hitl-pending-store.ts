export type HitlPendingEntry = {
  resolve: (response: string) => void;
  chat_id: string;
};

/** workflow HITL 응답 대기 상태의 단일 소유자. OrchestrationService와 ops-factory가 공유. */
export class HitlPendingStore {
  private readonly pending = new Map<string, HitlPendingEntry>();

  set(workflow_id: string, entry: HitlPendingEntry): void {
    this.pending.set(workflow_id, entry);
  }

  delete(workflow_id: string): void {
    this.pending.delete(workflow_id);
  }

  get(workflow_id: string): HitlPendingEntry | undefined {
    return this.pending.get(workflow_id);
  }

  /** chat_id로 pending 응답을 찾아 resolve하고 삭제. */
  try_resolve(chat_id: string, content: string): boolean {
    for (const [wf_id, entry] of this.pending) {
      if (entry.chat_id === chat_id) {
        this.pending.delete(wf_id);
        entry.resolve(content);
        return true;
      }
    }
    return false;
  }

  entries(): IterableIterator<[string, HitlPendingEntry]> {
    return this.pending.entries();
  }
}
