/** search 도메인 공개 API. */

export type {
  TokenizerPolicyLike,
  QueryNormalizerLike,
  LexicalProfile,
  TokenizerAdapterLike,
} from "./types.js";

export { Unicode61Tokenizer, DEFAULT_TOKENIZER } from "./unicode61-tokenizer.js";

export {
  UNICODE61_PROFILE,
  TOOL_INDEX_PROFILE,
  MEMORY_CHUNK_PROFILE,
  MEMORY_DOCUMENT_PROFILE,
  build_fts5_tokenize_clause,
  build_bm25_call,
} from "./lexical-profiles.js";
