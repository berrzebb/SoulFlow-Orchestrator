/** Tokenizer 도구 — 텍스트 토큰화, N-gram, TF-IDF, LLM 토큰 추정. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

const STOP_WORDS = new Set(["the","be","to","of","and","a","in","that","have","i","it","for","not","on","with","he","as","you","do","at","this","but","his","by","from","they","we","her","she","or","an","will","my","one","all","would","there","their","what","so","up","out","if","about","who","get","which","go","me","when","make","can","like","time","no","just","him","know","take","people","into","year","your","good","some","could","them","see","other","than","then","now","look","only","come","its","over","think","also","back","after","use","two","how","our","work","first","well","way","even","new","want","because","any","these","give","day","most","us"]);

export class TokenizerTool extends Tool {
  readonly name = "tokenizer";
  readonly category = "ai" as const;
  readonly description = "Text tokenization: word_tokenize, sentence_split, ngrams, tf_idf, keyword_extract, stopword_filter, token_estimate.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["word_tokenize", "sentence_split", "ngrams", "tf_idf", "keyword_extract", "stopword_filter", "token_estimate"], description: "Operation" },
      text: { type: "string", description: "Input text" },
      texts: { type: "string", description: "JSON array of texts (tf_idf)" },
      n: { type: "number", description: "N-gram size (default: 2)" },
      top_k: { type: "number", description: "Top K results (default: 10)" },
      model: { type: "string", description: "Model for token estimation (claude, gpt4, default)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "word_tokenize");
    const text = String(params.text || "");

    switch (action) {
      case "word_tokenize": {
        const tokens = this.tokenize(text);
        return JSON.stringify({ tokens, count: tokens.length });
      }
      case "sentence_split": {
        const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) || [text];
        return JSON.stringify({ sentences, count: sentences.length });
      }
      case "ngrams": {
        const n = Number(params.n) || 2;
        const tokens = this.tokenize(text);
        const ngrams: string[] = [];
        for (let i = 0; i <= tokens.length - n; i++) {
          ngrams.push(tokens.slice(i, i + n).join(" "));
        }
        const freq = new Map<string, number>();
        for (const ng of ngrams) freq.set(ng, (freq.get(ng) ?? 0) + 1);
        const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
        const top_k = Number(params.top_k) || 10;
        return JSON.stringify({ n, total: ngrams.length, unique: freq.size, top: sorted.slice(0, top_k).map(([ngram, count]) => ({ ngram, count })) });
      }
      case "tf_idf": {
        let texts: string[];
        try { texts = JSON.parse(String(params.texts || "[]")); } catch { return JSON.stringify({ error: "invalid texts JSON" }); }
        if (texts.length === 0 && text) texts = [text];
        if (texts.length === 0) return JSON.stringify({ error: "texts required" });
        const docs = texts.map((t) => this.tokenize(t.toLowerCase()));
        const df = new Map<string, number>();
        for (const doc of docs) {
          const unique = new Set(doc);
          for (const word of unique) df.set(word, (df.get(word) ?? 0) + 1);
        }
        const results = docs.map((doc, idx) => {
          const tf = new Map<string, number>();
          for (const word of doc) tf.set(word, (tf.get(word) ?? 0) + 1);
          const scores: { term: string; tf_idf: number }[] = [];
          for (const [term, count] of tf) {
            const tf_val = count / doc.length;
            const idf = Math.log(texts.length / (df.get(term) ?? 1));
            scores.push({ term, tf_idf: Math.round(tf_val * idf * 10000) / 10000 });
          }
          scores.sort((a, b) => b.tf_idf - a.tf_idf);
          const top_k = Number(params.top_k) || 10;
          return { doc_index: idx, top_terms: scores.slice(0, top_k) };
        });
        return JSON.stringify({ doc_count: texts.length, results });
      }
      case "keyword_extract": {
        const tokens = this.tokenize(text.toLowerCase());
        const filtered = tokens.filter((t) => !STOP_WORDS.has(t) && t.length > 2);
        const freq = new Map<string, number>();
        for (const t of filtered) freq.set(t, (freq.get(t) ?? 0) + 1);
        const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
        const top_k = Number(params.top_k) || 10;
        return JSON.stringify({ keywords: sorted.slice(0, top_k).map(([word, count]) => ({ word, count, score: Math.round((count / filtered.length) * 10000) / 10000 })) });
      }
      case "stopword_filter": {
        const tokens = this.tokenize(text);
        const filtered = tokens.filter((t) => !STOP_WORDS.has(t.toLowerCase()));
        const removed = tokens.length - filtered.length;
        return JSON.stringify({ original_count: tokens.length, filtered_count: filtered.length, removed, tokens: filtered });
      }
      case "token_estimate": {
        const model = String(params.model || "default");
        const char_count = text.length;
        const word_count = this.tokenize(text).length;
        // 대략적 추정: 영어 ~4 chars/token, Claude/GPT ~1.3 words/token
        let ratio = 4;
        if (model === "claude") ratio = 3.5;
        else if (model === "gpt4") ratio = 4;
        const estimated_tokens = Math.ceil(char_count / ratio);
        return JSON.stringify({
          char_count,
          word_count,
          estimated_tokens,
          model,
          note: "approximate estimation based on character ratio",
        });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private tokenize(text: string): string[] {
    return text.match(/\b\w+\b/g) || [];
  }
}
