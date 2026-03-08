export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API ${status}`);
  }
}

const REQUEST_TIMEOUT = 30_000; // 30초
const MAX_RETRIES = 2; // 최대 2회 재시도

async function request<T>(path: string, init?: RequestInit, attempt: number = 1): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(path, { cache: "no-store", ...init, signal: controller.signal });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
    return res.json() as Promise<T>;
  } catch (err) {
    // 네트워크 오류 또는 타임아웃이고 재시도 가능한 경우
    if ((err instanceof TypeError || err instanceof DOMException) && attempt < MAX_RETRIES + 1) {
      // 지수 백오프: 1초, 2초
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
      return request<T>(path, init, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export const api = {
  get: <T = unknown>(path: string) => request<T>(path),
  post: <T = unknown>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", headers: JSON_HEADERS, body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T = unknown>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", headers: JSON_HEADERS, body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T = unknown>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", headers: JSON_HEADERS, body: body !== undefined ? JSON.stringify(body) : undefined }),
  del: <T = unknown>(path: string, body?: unknown) =>
    request<T>(path, { method: "DELETE", headers: JSON_HEADERS, body: body !== undefined ? JSON.stringify(body) : undefined }),
};
