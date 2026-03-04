import { describe, it, expect, afterEach } from "vitest";
import { resolve_secrets, type SecretMapping } from "@src/agent/pty/secret-reader.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("resolve_secrets", () => {
  let tmp_dir: string;

  afterEach(() => {
    if (tmp_dir) rmSync(tmp_dir, { recursive: true, force: true });
  });

  it("시크릿 파일에서 값을 읽어 env 객체 반환", () => {
    tmp_dir = mkdtempSync(join(tmpdir(), "secret-test-"));
    writeFileSync(join(tmp_dir, "anthropic_key"), "sk-ant-123\n");
    writeFileSync(join(tmp_dir, "openai_key"), "  sk-oai-456  \n");

    const mappings: SecretMapping[] = [
      { env_key: "ANTHROPIC_API_KEY", secret_name: "anthropic_key" },
      { env_key: "OPENAI_API_KEY", secret_name: "openai_key" },
    ];

    const result = resolve_secrets(mappings, tmp_dir);
    expect(result).toEqual({
      ANTHROPIC_API_KEY: "sk-ant-123",
      OPENAI_API_KEY: "sk-oai-456",
    });
  });

  it("파일 미존재 시 해당 매핑 건너뜀", () => {
    tmp_dir = mkdtempSync(join(tmpdir(), "secret-test-"));
    writeFileSync(join(tmp_dir, "existing"), "value");

    const mappings: SecretMapping[] = [
      { env_key: "FOUND", secret_name: "existing" },
      { env_key: "MISSING", secret_name: "nonexistent" },
    ];

    const result = resolve_secrets(mappings, tmp_dir);
    expect(result).toEqual({ FOUND: "value" });
  });

  it("빈 매핑이면 빈 객체 반환", () => {
    expect(resolve_secrets([])).toEqual({});
  });

  it("디렉토리 미존재 시 빈 객체 반환", () => {
    const mappings: SecretMapping[] = [
      { env_key: "KEY", secret_name: "secret" },
    ];
    const result = resolve_secrets(mappings, "/nonexistent/path");
    expect(result).toEqual({});
  });
});
