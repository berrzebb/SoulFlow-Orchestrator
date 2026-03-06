import { lazy } from "react";

/**
 * 빌드 후 청크 해시가 바뀌면 이전 index.html을 캐시한 브라우저가
 * 존재하지 않는 청크를 요청 → "Failed to fetch dynamically imported module".
 * 한 번만 자동 리로드해서 새 index.html을 가져온다.
 */
export function lazyRetry<T extends { default: React.ComponentType }>(
  factory: () => Promise<T>,
): React.LazyExoticComponent<T["default"]> {
  return lazy(() =>
    factory().catch((err: unknown) => {
      const key = "chunk_reload";
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        window.location.reload();
        return new Promise(() => {});
      }
      sessionStorage.removeItem(key);
      throw err;
    }),
  );
}

/**
 * named export를 lazy load할 때 사용.
 * `lazyRetryNamed(() => import("./foo"), "FooComponent")`
 */
export function lazyRetryNamed<
  M extends Record<string, React.ComponentType>,
  K extends keyof M & string,
>(factory: () => Promise<M>, name: K): React.LazyExoticComponent<M[K]> {
  return lazyRetry(() =>
    factory().then((m) => ({ default: m[name] })),
  ) as React.LazyExoticComponent<M[K]>;
}
