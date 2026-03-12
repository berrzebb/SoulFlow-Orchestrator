/**
 * WorkspaceRegistry — 사용자별 런타임을 지연 초기화(lazy init)하고 캐시한다.
 * bootstrap_workspace 팩토리를 주입받아, 실제 런타임 생성 로직과 분리된다.
 */

import type { RuntimeApp } from "../main.js";

/** 각 사용자 워크스페이스가 보유하는 런타임 컨텍스트. */
export type WorkspaceRuntime = Omit<RuntimeApp, "dashboard"> & {
  /** 런타임 정리 (서비스 중지, 리소스 해제). */
  stop: () => Promise<void>;
};

/** 워크스페이스 경로를 받아 런타임을 생성하는 팩토리 함수. */
export type WorkspaceBootstrapFn = (workspace_path: string) => Promise<WorkspaceRuntime>;

export class WorkspaceRegistry {
  private readonly cache = new Map<string, WorkspaceRuntime>();
  private readonly bootstrap: WorkspaceBootstrapFn;

  constructor(bootstrap: WorkspaceBootstrapFn) {
    this.bootstrap = bootstrap;
  }

  /**
   * 워크스페이스 런타임 획득.
   * 캐시에 없으면 bootstrap_workspace() 실행 후 저장.
   */
  async get_or_create(workspace_path: string): Promise<WorkspaceRuntime> {
    const cached = this.cache.get(workspace_path);
    if (cached) return cached;

    const runtime = await this.bootstrap(workspace_path);
    this.cache.set(workspace_path, runtime);
    return runtime;
  }

  /**
   * 특정 워크스페이스 런타임 종료 및 캐시 제거.
   * 사용자 삭제 시 호출.
   */
  async remove(workspace_path: string): Promise<void> {
    const runtime = this.cache.get(workspace_path);
    if (!runtime) return;
    this.cache.delete(workspace_path);
    await runtime.stop().catch(() => {});
  }

  /**
   * 모든 워크스페이스 런타임 종료.
   * 서버 셧다운 시 호출.
   */
  async stop_all(): Promise<void> {
    const paths = [...this.cache.keys()];
    this.cache.clear();
    await Promise.allSettled(paths.map((p) => this.cache.get(p)?.stop() ?? Promise.resolve()));
  }

  /** 현재 활성 워크스페이스 수 (헬스체크용). */
  get size(): number {
    return this.cache.size;
  }

  /** 주어진 경로가 캐시에 있는지 (테스트/디버그용). */
  has(workspace_path: string): boolean {
    return this.cache.has(workspace_path);
  }
}
