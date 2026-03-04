/** 비동기 세마포어 — N 동시 실행 허용. 글로벌 레인에서 사용. */

type Waiter = {
  resolve: (release: () => void) => void;
};

export class Semaphore {
  private readonly max: number;
  private current = 0;
  private readonly waiters: Waiter[] = [];

  constructor(concurrency: number) {
    this.max = Math.max(1, concurrency);
  }

  /** 슬롯을 획득. 반환된 함수를 호출하면 슬롯 반환. */
  async acquire(): Promise<() => void> {
    if (this.current < this.max) {
      this.current++;
      return this.create_release();
    }
    return new Promise<() => void>((resolve) => {
      this.waiters.push({ resolve });
    });
  }

  get available(): number {
    return Math.max(0, this.max - this.current);
  }

  get waiting(): number {
    return this.waiters.length;
  }

  private create_release(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.current--;
      const next = this.waiters.shift();
      if (next) {
        this.current++;
        next.resolve(this.create_release());
      }
    };
  }
}
