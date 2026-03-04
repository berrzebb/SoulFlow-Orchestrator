import { describe, it, expect } from "vitest";
import { Semaphore } from "@src/agent/pty/semaphore.ts";

describe("Semaphore", () => {
  it("concurrency=1이면 순차 실행", async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];

    const run = async (n: number) => {
      const release = await sem.acquire();
      order.push(n);
      await new Promise((r) => setTimeout(r, 10));
      release();
    };

    await Promise.all([run(1), run(2), run(3)]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("concurrency=2이면 2개씩 병렬 실행", async () => {
    const sem = new Semaphore(2);
    let concurrent = 0;
    let max_concurrent = 0;

    const run = async () => {
      const release = await sem.acquire();
      concurrent++;
      max_concurrent = Math.max(max_concurrent, concurrent);
      await new Promise((r) => setTimeout(r, 20));
      concurrent--;
      release();
    };

    await Promise.all([run(), run(), run(), run()]);
    expect(max_concurrent).toBe(2);
  });

  it("available이 정확히 추적된다", async () => {
    const sem = new Semaphore(3);
    expect(sem.available).toBe(3);

    const r1 = await sem.acquire();
    expect(sem.available).toBe(2);

    const r2 = await sem.acquire();
    expect(sem.available).toBe(1);

    r1();
    expect(sem.available).toBe(2);

    r2();
    expect(sem.available).toBe(3);
  });

  it("이중 release는 무시된다", async () => {
    const sem = new Semaphore(1);
    const release = await sem.acquire();
    release();
    release(); // 두 번째 호출 무시
    expect(sem.available).toBe(1);
  });

  it("waiting 카운트를 추적한다", async () => {
    const sem = new Semaphore(1);
    const release = await sem.acquire();
    expect(sem.waiting).toBe(0);

    // 대기자 추가
    const p2 = sem.acquire();
    expect(sem.waiting).toBe(1);

    release();
    const r2 = await p2;
    expect(sem.waiting).toBe(0);
    r2();
  });
});
