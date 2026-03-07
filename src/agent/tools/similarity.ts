/** Similarity 도구 — 텍스트/벡터 유사도 측정. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class SimilarityTool extends Tool {
  readonly name = "similarity";
  readonly category = "ai" as const;
  readonly description = "Similarity measures: cosine, jaccard, levenshtein, hamming, dice, jaro_winkler, euclidean.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["cosine", "jaccard", "levenshtein", "hamming", "dice", "jaro_winkler", "euclidean"], description: "Similarity metric" },
      a: { type: "string", description: "First text or JSON vector" },
      b: { type: "string", description: "Second text or JSON vector" },
    },
    required: ["action", "a", "b"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "levenshtein");
    const a = String(params.a || "");
    const b = String(params.b || "");

    switch (action) {
      case "cosine": {
        const va = this.parse_vector(a);
        const vb = this.parse_vector(b);
        if (!va || !vb) {
          // 텍스트 모드: 단어 빈도 벡터 생성
          return JSON.stringify(this.text_cosine(a, b));
        }
        if (va.length !== vb.length) return JSON.stringify({ error: "vectors must have same length" });
        let dot = 0, norm_a = 0, norm_b = 0;
        for (let i = 0; i < va.length; i++) { dot += va[i] * vb[i]; norm_a += va[i] ** 2; norm_b += vb[i] ** 2; }
        const denom = Math.sqrt(norm_a) * Math.sqrt(norm_b);
        const similarity = denom > 0 ? dot / denom : 0;
        return JSON.stringify({ similarity: Math.round(similarity * 1e6) / 1e6, metric: "cosine" });
      }
      case "jaccard": {
        const set_a = new Set(a.toLowerCase().split(/\s+/));
        const set_b = new Set(b.toLowerCase().split(/\s+/));
        let intersection = 0;
        for (const w of set_a) if (set_b.has(w)) intersection++;
        const union = set_a.size + set_b.size - intersection;
        const similarity = union > 0 ? intersection / union : 0;
        return JSON.stringify({ similarity: Math.round(similarity * 1e6) / 1e6, intersection, union, metric: "jaccard" });
      }
      case "levenshtein": {
        const dist = this.levenshtein(a, b);
        const max_len = Math.max(a.length, b.length);
        const similarity = max_len > 0 ? 1 - dist / max_len : 1;
        return JSON.stringify({ distance: dist, similarity: Math.round(similarity * 1e6) / 1e6, max_length: max_len, metric: "levenshtein" });
      }
      case "hamming": {
        if (a.length !== b.length) return JSON.stringify({ error: "strings must have same length for hamming distance" });
        let dist = 0;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) dist++;
        const similarity = a.length > 0 ? 1 - dist / a.length : 1;
        return JSON.stringify({ distance: dist, similarity: Math.round(similarity * 1e6) / 1e6, length: a.length, metric: "hamming" });
      }
      case "dice": {
        const bigrams_a = this.bigrams(a.toLowerCase());
        const bigrams_b = this.bigrams(b.toLowerCase());
        let intersection = 0;
        const b_copy = [...bigrams_b];
        for (const bg of bigrams_a) {
          const idx = b_copy.indexOf(bg);
          if (idx >= 0) { intersection++; b_copy.splice(idx, 1); }
        }
        const total = bigrams_a.length + bigrams_b.length;
        const similarity = total > 0 ? (2 * intersection) / total : 0;
        return JSON.stringify({ similarity: Math.round(similarity * 1e6) / 1e6, metric: "dice_coefficient" });
      }
      case "jaro_winkler": {
        const jaro = this.jaro(a, b);
        // Winkler 보정
        let prefix = 0;
        for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
          if (a[i] === b[i]) prefix++;
          else break;
        }
        const similarity = jaro + prefix * 0.1 * (1 - jaro);
        return JSON.stringify({ similarity: Math.round(similarity * 1e6) / 1e6, jaro: Math.round(jaro * 1e6) / 1e6, common_prefix: prefix, metric: "jaro_winkler" });
      }
      case "euclidean": {
        const va = this.parse_vector(a);
        const vb = this.parse_vector(b);
        if (!va || !vb) return JSON.stringify({ error: "valid JSON number arrays required" });
        if (va.length !== vb.length) return JSON.stringify({ error: "vectors must have same length" });
        let sum = 0;
        for (let i = 0; i < va.length; i++) sum += (va[i] - vb[i]) ** 2;
        const distance = Math.sqrt(sum);
        const similarity = 1 / (1 + distance);
        return JSON.stringify({ distance: Math.round(distance * 1e6) / 1e6, similarity: Math.round(similarity * 1e6) / 1e6, metric: "euclidean" });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private parse_vector(val: string): number[] | null {
    try {
      const arr = JSON.parse(val);
      if (Array.isArray(arr) && arr.every((v: unknown) => typeof v === "number")) return arr;
      return null;
    } catch { return null; }
  }

  private text_cosine(a: string, b: string): { similarity: number; metric: string } {
    const words_a = a.toLowerCase().match(/\b\w+\b/g) || [];
    const words_b = b.toLowerCase().match(/\b\w+\b/g) || [];
    const vocab = new Set([...words_a, ...words_b]);
    const freq_a = new Map<string, number>();
    const freq_b = new Map<string, number>();
    for (const w of words_a) freq_a.set(w, (freq_a.get(w) ?? 0) + 1);
    for (const w of words_b) freq_b.set(w, (freq_b.get(w) ?? 0) + 1);
    let dot = 0, norm_a = 0, norm_b = 0;
    for (const w of vocab) {
      const fa = freq_a.get(w) ?? 0;
      const fb = freq_b.get(w) ?? 0;
      dot += fa * fb;
      norm_a += fa ** 2;
      norm_b += fb ** 2;
    }
    const denom = Math.sqrt(norm_a) * Math.sqrt(norm_b);
    return { similarity: denom > 0 ? Math.round((dot / denom) * 1e6) / 1e6 : 0, metric: "cosine_text" };
  }

  private bigrams(s: string): string[] {
    const result: string[] = [];
    for (let i = 0; i < s.length - 1; i++) result.push(s.slice(i, i + 2));
    return result;
  }

  private levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }
    return dp[m][n];
  }

  private jaro(a: string, b: string): number {
    if (a === b) return 1;
    const len_a = a.length, len_b = b.length;
    if (len_a === 0 || len_b === 0) return 0;
    const match_dist = Math.max(Math.floor(Math.max(len_a, len_b) / 2) - 1, 0);
    const a_matches = new Array(len_a).fill(false);
    const b_matches = new Array(len_b).fill(false);
    let matches = 0, transpositions = 0;
    for (let i = 0; i < len_a; i++) {
      const start = Math.max(0, i - match_dist);
      const end = Math.min(i + match_dist + 1, len_b);
      for (let j = start; j < end; j++) {
        if (b_matches[j] || a[i] !== b[j]) continue;
        a_matches[i] = true; b_matches[j] = true; matches++; break;
      }
    }
    if (matches === 0) return 0;
    let k = 0;
    for (let i = 0; i < len_a; i++) {
      if (!a_matches[i]) continue;
      while (!b_matches[k]) k++;
      if (a[i] !== b[k]) transpositions++;
      k++;
    }
    return (matches / len_a + matches / len_b + (matches - transpositions / 2) / matches) / 3;
  }
}
