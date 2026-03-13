/**
 * SH-3 Filesystem Containment 회귀 테스트.
 * - references upload: sanitize_filename + is_inside 로 .. 차단
 * - admin team DELETE: sanitize_filename으로 team_id 무력화
 */
import { describe, it, expect } from "vitest";
import { join, resolve } from "node:path";
import { sanitize_filename, is_inside } from "@src/dashboard/ops/shared.js";

describe("SH-3: sanitize_filename — path traversal 방어", () => {
  it("정상 파일명 → 변환 없음", () => {
    expect(sanitize_filename("report.pdf")).toBe("report.pdf");
  });

  it(".. 제거", () => {
    expect(sanitize_filename("..")).toBe("");
  });

  it("../../etc/passwd → 슬래시 + .. 모두 제거", () => {
    expect(sanitize_filename("../../etc/passwd")).toBe("etcpasswd");
  });

  it("슬래시 포함 → 제거", () => {
    expect(sanitize_filename("sub/dir/file.txt")).toBe("subdirfile.txt");
  });

  it("백슬래시 포함 → 제거", () => {
    expect(sanitize_filename("sub\\dir\\file.txt")).toBe("subdirfile.txt");
  });
});

describe("SH-3: is_inside — containment 검증", () => {
  const base = resolve("/workspace/refs");

  it("동일 경로 → true", () => {
    expect(is_inside(base, base)).toBe(true);
  });

  it("하위 경로 → true", () => {
    expect(is_inside(base, join(base, "file.txt"))).toBe(true);
  });

  it(".. 탈출 → false", () => {
    expect(is_inside(base, resolve(base, "..", "secret.txt"))).toBe(false);
  });

  it("접두사만 일치하는 다른 경로 → false", () => {
    expect(is_inside(base, resolve(base + "-evil", "file.txt"))).toBe(false);
  });
});

describe("SH-3: references upload 시나리오", () => {
  it("filename '..' → sanitize_filename이 빈 문자열 반환 → 400 거부", () => {
    const filename = sanitize_filename("..");
    // 빈 문자열이면 "filename required" 에러로 빠짐
    expect(filename).toBe("");
  });

  it("filename '../../etc/passwd' → sanitize 후 is_inside 통과", () => {
    const refs_dir = resolve("/workspace/refs");
    const filename = sanitize_filename("../../etc/passwd");
    const filepath = join(refs_dir, filename);
    expect(is_inside(refs_dir, filepath)).toBe(true);
    expect(filename).toBe("etcpasswd"); // 안전한 파일명
  });
});

describe("SH-3: admin team DELETE 시나리오", () => {
  it("team_id '..' → sanitize_filename이 빈 문자열 반환 → rmSync 차단", () => {
    const safe_id = sanitize_filename("..");
    expect(safe_id).toBe(""); // falsy → rmSync 미실행
  });

  it("team_id 'team-1' → 정상 경로", () => {
    const workspace = resolve("/workspace");
    const safe_id = sanitize_filename("team-1");
    const tenants_base = join(workspace, "tenants");
    const tenant_dir = join(tenants_base, safe_id);
    expect(safe_id).toBe("team-1");
    expect(is_inside(tenants_base, tenant_dir)).toBe(true);
  });

  it("team_id '../..' → sanitize 후 빈 문자열", () => {
    const safe_id = sanitize_filename("../..");
    expect(safe_id).toBe("");
  });
});
