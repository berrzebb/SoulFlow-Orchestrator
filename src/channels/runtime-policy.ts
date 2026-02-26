import type { RuntimeExecutionPolicy } from "../providers/index.js";
import { is_local_reference } from "../utils/local-ref.js";

export interface RuntimePolicyResolver {
  resolve(task: string, media_inputs: string[]): RuntimeExecutionPolicy;
}

export class DefaultRuntimePolicyResolver implements RuntimePolicyResolver {
  resolve(task: string, media_inputs: string[]): RuntimeExecutionPolicy {
    const text = String(task || "");
    const has_web_link = /https?:\/\/[^\s]+/i.test(text);
    const has_network_keyword = /(web|웹|브라우저|browser|search|탐색|fetch|crawl|scrape|download|다운로드|mcp|api)/i.test(text);
    const has_non_local_media = (media_inputs || []).some((row) => {
      const value = String(row || "").trim();
      if (!value) return false;
      return !is_local_reference(value);
    });
    const needs_network = has_web_link || has_network_keyword || has_non_local_media;
    if (needs_network) {
      return {
        permission_profile: "full-auto",
        command_profile: "extended",
      };
    }
    return {
      permission_profile: "workspace-write",
      command_profile: "balanced",
    };
  }
}
