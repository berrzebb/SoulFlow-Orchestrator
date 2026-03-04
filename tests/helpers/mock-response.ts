/** ServerResponse 모킹 헬퍼. dashboard 테스트에서 공유. */

import { vi } from "vitest";

export type MockResponse = {
  statusCode: number;
  setHeader: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  __listeners: Map<string, Function>;
  __trigger: (event: string) => void;
};

export function make_mock_response(): MockResponse {
  const listeners = new Map<string, Function>();
  return {
    statusCode: 0,
    setHeader: vi.fn(),
    end: vi.fn(),
    write: vi.fn(),
    on: vi.fn((event: string, cb: Function) => { listeners.set(event, cb); }),
    __listeners: listeners,
    __trigger: (event: string) => { listeners.get(event)?.(); },
  };
}
