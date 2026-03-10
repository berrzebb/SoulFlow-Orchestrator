/**
 * ArchiveTool + TokenizerTool — 미커버 분기 보충.
 */
import { describe, it, expect } from "vitest";
import { ArchiveTool } from "@src/agent/tools/archive.js";
import { TokenizerTool } from "@src/agent/tools/tokenizer.js";

// ══════════════════════════════════════════
// ArchiveTool — build_command default 분기 (L67, L75)
// ══════════════════════════════════════════

const archive = new ArchiveTool({ workspace: "/tmp" });

describe("ArchiveTool — build_command default 분기", () => {
  it("tar.gz: 알 수 없는 operation → L67 default → null → Error (L44)", async () => {
    // build_command("unknown", "tar.gz", ...) → switch default → null → L44 error
    const r = await archive.execute({ operation: "unknown" as any, format: "tar.gz", archive_path: "/tmp/test.tar.gz" });
    expect(r).toContain("Error");
  });

  it("zip: 알 수 없는 operation → L75 default → null → Error (L44)", async () => {
    // build_command("unknown", "zip", ...) → zip switch default → null
    const r = await archive.execute({ operation: "unknown" as any, format: "zip", archive_path: "/tmp/test.zip" });
    expect(r).toContain("Error");
  });
});

// ══════════════════════════════════════════
// TokenizerTool — tf_idf 미커버 분기 (L54 catch, L56 error)
// ══════════════════════════════════════════

const tokenizer = new TokenizerTool();

describe("TokenizerTool — tf_idf 미커버 분기", () => {
  it("texts가 잘못된 JSON → L54 catch → error", async () => {
    const r = JSON.parse(await tokenizer.execute({ action: "tf_idf", texts: "not-json-array" }));
    expect(r.error).toContain("invalid texts JSON");
  });

  it("texts=[] + text 없음 → L56 texts required → error", async () => {
    const r = JSON.parse(await tokenizer.execute({ action: "tf_idf", texts: "[]" }));
    expect(r.error).toContain("texts required");
  });
});
