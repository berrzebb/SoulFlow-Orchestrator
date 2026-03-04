import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve_web_dir, serve_static } from "@src/dashboard/static-server.ts";
import { make_mock_response } from "@helpers/mock-response.ts";

describe("resolve_web_dir", () => {
  it("string을 반환한다", () => {
    const dir = resolve_web_dir();
    expect(dir).toBeTypeOf("string");
    expect(dir.length).toBeGreaterThan(0);
  });
});

describe("serve_static", () => {
  let web_dir: string;

  beforeAll(async () => {
    web_dir = await mkdtemp(join(tmpdir(), "static-test-"));
    await writeFile(join(web_dir, "index.html"), "<html>SPA</html>");
    await mkdir(join(web_dir, "assets"), { recursive: true });
    await writeFile(join(web_dir, "assets", "style.css"), "body { color: red; }");
    await writeFile(join(web_dir, "app.js"), "console.log('app');");
  });

  afterAll(async () => {
    await rm(web_dir, { recursive: true, force: true });
  });

  describe("경로 처리", () => {
    it("/web/ 접두사를 제거하고 파일을 서빙한다", async () => {
      const res = make_mock_response();
      await serve_static(web_dir, "/web/app.js", res as any);
      expect(res.statusCode).toBe(200);
      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/javascript");
    });

    it("/web으로 요청 시 index.html을 서빙한다", async () => {
      const res = make_mock_response();
      await serve_static(web_dir, "/web/", res as any);
      expect(res.statusCode).toBe(200);
      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/html");
    });

    it(".. 경로 순회를 방어한다", async () => {
      const res = make_mock_response();
      await serve_static(web_dir, "/web/../../etc/passwd", res as any);
      // ".." 제거 → "etcpasswd" → 파일 없음 → SPA fallback
      expect(res.statusCode).toBe(200);
      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/html; charset=utf-8");
    });
  });

  describe("캐시 헤더", () => {
    it("HTML 파일은 no-cache 헤더를 설정한다", async () => {
      const res = make_mock_response();
      await serve_static(web_dir, "/web/index.html", res as any);
      const cache_calls = res.setHeader.mock.calls.filter(
        (c: unknown[]) => c[0] === "Cache-Control",
      );
      const has_no_cache = cache_calls.some((c: unknown[]) => String(c[1]).includes("no-cache") || String(c[1]).includes("no-store"));
      expect(has_no_cache).toBe(true);
    });

    it("비-HTML 파일은 immutable 캐시를 설정한다", async () => {
      const res = make_mock_response();
      await serve_static(web_dir, "/web/assets/style.css", res as any);
      expect(res.setHeader).toHaveBeenCalledWith(
        "Cache-Control",
        "public, max-age=31536000, immutable",
      );
    });
  });

  describe("SPA fallback", () => {
    it("존재하지 않는 경로는 index.html로 폴백한다", async () => {
      const res = make_mock_response();
      await serve_static(web_dir, "/web/unknown/route", res as any);
      expect(res.statusCode).toBe(200);
      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/html; charset=utf-8");
    });

    it("index.html도 없으면 404를 반환한다", async () => {
      const empty_dir = await mkdtemp(join(tmpdir(), "empty-web-"));
      try {
        const res = make_mock_response();
        await serve_static(empty_dir, "/web/anything", res as any);
        expect(res.statusCode).toBe(404);
        expect(res.end).toHaveBeenCalledWith("not_found");
      } finally {
        await rm(empty_dir, { recursive: true, force: true });
      }
    });
  });

  describe("MIME 타입", () => {
    it("확장자에 따른 Content-Type을 설정한다", async () => {
      const res = make_mock_response();
      await serve_static(web_dir, "/web/assets/style.css", res as any);
      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/css");
    });
  });
});
