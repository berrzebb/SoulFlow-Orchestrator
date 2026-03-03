import { describe, it, expect } from "vitest";
import { is_local_reference } from "@src/utils/local-ref.ts";

describe("local ref safety", () => {
  it("basename detection uses safe extension allowlist", () => {
    expect(is_local_reference("package.json")).toBe(true);
    expect(is_local_reference("notes.txt")).toBe(true);
    expect(is_local_reference("hello.world")).toBe(false);
    expect(is_local_reference("my.name.is.john")).toBe(false);
    expect(is_local_reference("https://example.com/file.txt")).toBe(false);
  });
});
