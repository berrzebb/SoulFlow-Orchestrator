import { describe, it, expect } from "vitest";
import {
  normalize_local_candidate_path,
  is_local_reference,
  resolve_local_reference,
} from "@src/utils/local-ref.js";

describe("normalize_local_candidate_path", () => {
  it("returns empty for empty/null input", () => {
    expect(normalize_local_candidate_path("")).toBe("");
    expect(normalize_local_candidate_path("  ")).toBe("");
  });

  it("strips surrounding quotes and brackets", () => {
    expect(normalize_local_candidate_path('"./file.txt"')).toBe("./file.txt");
    expect(normalize_local_candidate_path("'./file.txt'")).toBe("./file.txt");
    expect(normalize_local_candidate_path("<./file.txt>")).toBe("./file.txt");
  });

  it("strips trailing punctuation", () => {
    expect(normalize_local_candidate_path("./file.txt.")).toBe("./file.txt");
    expect(normalize_local_candidate_path("./file.txt,")).toBe("./file.txt");
  });

  it("extracts path from markdown link", () => {
    expect(normalize_local_candidate_path("[label](./path/to/file.txt)")).toBe("./path/to/file.txt");
  });

  it("handles file:// URLs (Unix)", () => {
    expect(normalize_local_candidate_path("file:///home/user/file.txt")).toBe("/home/user/file.txt");
  });

  it("decodes percent-encoded paths", () => {
    expect(normalize_local_candidate_path("./my%20file.txt")).toBe("./my file.txt");
  });

  it("normalizes double backslashes to single", () => {
    expect(normalize_local_candidate_path("src\\\\dir\\\\file.ts")).toBe("src\\dir\\file.ts");
  });
});

describe("is_local_reference", () => {
  it("returns false for empty", () => {
    expect(is_local_reference("")).toBe(false);
  });

  it("returns false for HTTP URLs", () => {
    expect(is_local_reference("https://example.com/file.txt")).toBe(false);
    expect(is_local_reference("http://example.com")).toBe(false);
  });

  it("returns false for other protocol URLs", () => {
    expect(is_local_reference("ftp://server/file")).toBe(false);
    expect(is_local_reference("s3://bucket/key")).toBe(false);
  });

  it("returns true for absolute Unix paths", () => {
    expect(is_local_reference("/home/user/file.txt")).toBe(true);
  });

  it("returns true for Windows paths", () => {
    expect(is_local_reference("C:\\Users\\file.txt")).toBe(true);
    expect(is_local_reference("D:/projects/file.ts")).toBe(true);
  });

  it("returns true for relative paths", () => {
    expect(is_local_reference("./file.txt")).toBe(true);
    expect(is_local_reference("../file.txt")).toBe(true);
    expect(is_local_reference("src/file.ts")).toBe(true);
  });

  it("returns true for UNC paths", () => {
    expect(is_local_reference("\\\\server\\share\\file")).toBe(true);
  });

  it("returns true for safe basename references", () => {
    expect(is_local_reference("report.pdf")).toBe(true);
    expect(is_local_reference("data.json")).toBe(true);
  });

  it("returns false for non-file strings", () => {
    expect(is_local_reference("just some text")).toBe(false);
  });
});

describe("resolve_local_reference", () => {
  it("resolves relative path within workspace", () => {
    const resolved = resolve_local_reference("/workspace", "./src/file.ts");
    expect(resolved).toContain("file.ts");
    expect(resolved).toBeTruthy();
  });

  it("returns empty for path outside workspace (directory traversal)", () => {
    const resolved = resolve_local_reference("/workspace", "../../etc/passwd");
    expect(resolved).toBe("");
  });

  it("returns empty for empty path", () => {
    expect(resolve_local_reference("/workspace", "")).toBe("");
  });
});

// L27: normalize_local_candidate_path — Windows 절대 경로 file URL
describe("normalize_local_candidate_path — Windows file:// URL (L27)", () => {
  it("file:///C:/Users/foo/bar.txt → C:\\Users\\foo\\bar.txt (L27)", () => {
    const result = normalize_local_candidate_path("file:///C:/Users/foo/bar.txt");
    // /^\/[A-Za-z]:\//.test("/C:/...") → true → decoded.slice(1).replace(/\//g, "\\")
    expect(result).toBe("C:\\Users\\foo\\bar.txt");
  });
});
