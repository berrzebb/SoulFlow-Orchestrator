import type { SecretVaultService } from "../../security/secret-vault.js";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

/** 오케스트레이터가 시크릿을 조회·등록할 수 있는 도구. reveal은 보안상 제외. */
export class SecretTool extends Tool {
  readonly name = "secret";
  readonly description = "시크릿 저장소 관리. action=list|get|set|remove|status";
  readonly parameters: JsonSchema = {
    type: "object",
    required: ["action"],
    properties: {
      action: { type: "string", enum: ["list", "get", "set", "remove", "status"] },
      name: { type: "string", description: "시크릿 이름 (get/set/remove 시 필수)" },
      value: { type: "string", description: "시크릿 값 (set 시 필수)" },
    },
  };

  private readonly vault: SecretVaultService;

  constructor(vault: SecretVaultService) {
    super();
    this.vault = vault;
  }

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "").trim();

    if (action === "list") {
      const names = await this.vault.list_names();
      if (names.length === 0) return "(등록된 시크릿 없음)";
      return `등록된 시크릿 (${names.length}개):\n${names.map((n) => `- ${n}`).join("\n")}`;
    }

    if (action === "get") {
      const name = String(params.name || "").trim();
      if (!name) return "Error: name is required";
      const cipher = await this.vault.get_secret_cipher(name);
      if (!cipher) return `시크릿 "${name}" 없음`;
      return `{{secret:${name}}} → (암호화됨, ${cipher.length}자)`;
    }

    if (action === "set") {
      const name = String(params.name || "").trim();
      const value = String(params.value || "").trim();
      if (!name || !value) return "Error: name and value are required for set";
      const result = await this.vault.put_secret(name, value);
      return result.ok ? `시크릿 "${result.name}" 저장 완료.` : "Error: 시크릿 저장 실패";
    }

    if (action === "remove") {
      const name = String(params.name || "").trim();
      if (!name) return "Error: name is required";
      const exists = await this.vault.get_secret_cipher(name);
      if (!exists) return `시크릿 "${name}" 없음`;
      await this.vault.remove_secret(name);
      return `시크릿 "${name}" 삭제 완료.`;
    }

    if (action === "status") {
      const names = await this.vault.list_names();
      const paths = this.vault.get_paths();
      return [
        `시크릿 수: ${names.length}`,
        `저장 경로: ${paths.store_path}`,
        `마스터 키: ${paths.key_path}`,
      ].join("\n");
    }

    return `Error: unknown action "${action}"`;
  }
}
