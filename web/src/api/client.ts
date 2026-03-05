export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API ${status}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: "no-store", ...init });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return res.json() as Promise<T>;
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
