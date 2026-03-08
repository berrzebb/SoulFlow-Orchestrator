# 설계: RAG Reference Store 확장

> **Status**: `planned` | **Type**: 기능 확장

## 현황 분석

### 이미 구현된 것

| 컴포넌트 | 상태 | 설명 |
|---------|------|------|
| `ReferenceStore` | ✅ 완성 | `workspace/references/` → FTS5+KNN hybrid, lazy embed, debounce sync |
| `_build_reference_context()` | ✅ 완성 | 사용자 메시지로 검색 → 시스템 프롬프트 주입 |
| `sqlite-vec` KNN | ✅ 완성 | L2 normalized 벡터, 256차원 |
| `EmbedFn` 주입 | ✅ 완성 | `set_embed()` → `agent-core.ts`에서 연결 |

### 없는 것 (이번 설계 범위)

| 대상 | 현재 | 목표 |
|------|------|------|
| `skills/*/references/*.md` | SKILL.md 링크만, 미인덱싱 | RAG 인덱싱 → 관련 청크만 주입 |
| `.pdf`, `.docx`, `.hwpx` | `SUPPORTED_EXTENSIONS` 미포함 | 텍스트 추출 → 청킹 → 인덱싱 |
| 이미지 (`.jpg`, `.png` 등) | 미지원 | 멀티모달 임베딩 모델 조건부 인덱싱 |
| 영상 (`.mp4`, `.webm` 등) | 미지원 | 프레임 샘플링(ffmpeg) + 오디오 전사(Whisper) |

---

## 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                    RAGStore (통합 인터페이스)               │
│  ┌──────────────────┐    ┌──────────────────────────┐   │
│  │  ReferenceStore  │    │    SkillRefStore          │   │
│  │  workspace/      │    │  src/skills/*/           │   │
│  │  references/     │    │  references/*.md          │   │
│  └──────────────────┘    └──────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
         │ search(query)           │ search(query, skill?)
         └───────────┬─────────────┘
                     ▼
          context.service.ts
          _build_reference_context()
          _build_skill_reference_context()  ← 신규
```

### 인덱싱 파이프라인

```
파일 감지 (sync)
    │
    ├── .md / .txt / ... (기존 텍스트)
    │       └── chunk_text() → FTS5 + vec0
    │
    ├── .pdf / .docx / .hwpx  ← Phase 1 신규
    │       └── extract_text() → chunk_text() → FTS5 + vec0
    │
    ├── .jpg / .png / .webp   ← Phase 2 신규
    │       └── encode_base64() → embed_image() → vec0 only
    │
    └── .mp4 / .webm          ← Phase 3 신규
            ├── ffmpeg → frames → embed_image() → vec0
            └── Whisper → transcript → chunk_text() → FTS5 + vec0
```

---

## Phase 1: 바이너리 텍스트 문서 지원

### 추출 전략

| 포맷 | 방법 | 패키지 |
|------|------|--------|
| `.pdf` | `PdfTool` 기존 로직 재사용 (`extract_pdf_text`) | 내장 (pdf-lib 우회, 직접 파싱) |
| `.docx` | DOCX XML 언패킹 → `word/document.xml` 파싱 | `mammoth` npm |
| `.hwpx` | ZIP 언패킹 → `Contents/section0.xml` 파싱 | Node.js `unzip` (native AdmZip) |

#### `ReferenceStore` 변경점

```typescript
// SUPPORTED_EXTENSIONS에 추가
const SUPPORTED_EXTENSIONS = new Set([
  // 기존 텍스트 포맷 ...
  ".pdf", ".docx", ".hwpx",               // ← Phase 1 추가
]);

// chunk_text() 분기 확장
private async chunk_text_async(content_or_path: string, source_path: string, raw_buf?: Buffer): Promise<ReferenceChunk[]> {
  const ext = extname(source_path).toLowerCase();
  if ([".pdf", ".docx", ".hwpx"].includes(ext)) {
    const text = await this.extract_binary_text(raw_buf!, ext);
    return this.chunk_fixed(text, source_path);
  }
  // 기존 sync 경로
  const ext2 = extname(source_path).toLowerCase();
  if (ext2 === ".md") return this.chunk_markdown(content_or_path, source_path);
  return this.chunk_fixed(content_or_path, source_path);
}
```

> **주의**: `sync()`는 현재 동기(readFileSync). 바이너리 추출 시 async로 전환 필요.
> `chunk_text()`를 `async chunk_text()`로 변경하고 sync() 내부를 `await` 처리.

#### PDF 추출 — 자체 구현 (외부 의존성 없음)

`PdfTool`의 `extract_pdf_text()` 로직을 `reference-store.ts`에서 직접 재사용:
```typescript
import { PdfTool } from "../agent/tools/pdf.js"; // 정적 메서드 추출 또는 복사
```

또는 공통 `extract_pdf_text(buf: Buffer): string` 유틸 함수로 분리 → `src/utils/doc-extractor.ts`.

#### DOCX 추출 — mammoth

```typescript
import mammoth from "mammoth";
const { value: text } = await mammoth.extractRawText({ buffer: buf });
```

#### HWPX 추출 — AdmZip + XML

```typescript
import AdmZip from "adm-zip";
const zip = new AdmZip(buf);
const entry = zip.getEntry("Contents/section0.xml");
const xml = entry?.getData().toString("utf-8") ?? "";
// XML 태그 제거: /<[^>]+>/g → ''
const text = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
```

### 패키지 추가

```bash
npm install mammoth adm-zip
npm install --save-dev @types/adm-zip
```

---

## Phase 1b: Skills References RAG (SkillRefStore)

### 목적

현재 `load_skills_for_context()`는 SKILL.md body 전체를 주입.
`file-maker/references/pdf.md` 같은 상세 레퍼런스는 링크만 있고 실제 내용은 미주입.
→ 쿼리와 관련된 레퍼런스 청크만 검색해서 주입.

### 설계

`SkillRefStore` — `ReferenceStore`와 동일 인터페이스(`ReferenceStoreLike`), 별도 DB.

```typescript
// src/services/skill-ref-store.ts
export class SkillRefStore implements ReferenceStoreLike {
  constructor(
    private readonly skills_roots: string[],  // ["src/skills", "workspace/skills"]
    private readonly data_dir: string,
  ) { ... }
  // scan_files(): skills_roots 하위 모든 references/*.md 스캔
  // DB: runtime/skill-refs.db
}
```

스캔 경로: `skills_root/**/references/**/*.md` (단, `SKILL.md` 자체는 제외).

### 컨텍스트 주입

```typescript
// context.service.ts 신규 메서드
private async _build_skill_reference_context(
  user_message: string,
  active_skill_names: string[],
): Promise<string> {
  if (!this._skill_ref_store) return "";
  const results = await this._skill_ref_store.search(user_message, {
    limit: 4,
    doc_filter: active_skill_names.length > 0
      ? active_skill_names.join("|")
      : undefined,
  });
  // ...포맷 후 반환
}
```

`active_skill_names`는 `build_context()` 호출 시 이미 전달되는 `skill_names` 재사용.

---

## Phase 2: 이미지 지원

### 조건

`embed_fn` 모델이 멀티모달 지원 여부를 런타임에 감지:

```typescript
// EmbedFn 확장
type EmbedInput = string | { image_url: string } | { image_base64: string };
type EmbedFn = (inputs: EmbedInput[], opts: { model?: string; dimensions?: number }) => Promise<{ embeddings: number[][] }>;
```

`set_embed()` 후 probe 호출로 이미지 지원 여부 확인 → `this.multimodal_supported` 플래그.

### 이미지 인덱싱

```typescript
const SUPPORTED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

// sync()에서 이미지 파일 처리
const b64 = readFileSync(abs_path).toString("base64");
const data_url = `data:image/${ext.slice(1)};base64,${b64}`;
// FTS 없음 — vec0만
to_embed_multimodal.push({ chunk_id, input: { image_base64: data_url } });
```

메타데이터: `{ type: "image", file_name, alt_text: ""  }` — 향후 사용자가 설명 추가 가능.

### API 형식 (jina-clip-v2 예시)

```json
{
  "model": "jina-clip-v2",
  "input": [
    { "text": "쿼리 텍스트" },
    { "image": "data:image/png;base64,..." }
  ]
}
```

현재 `EmbeddingTool`의 `call_api()`는 `input: string[]`만 지원 → 확장 필요.

---

## Phase 3: 영상 지원

### 파이프라인

```
video file (.mp4, .webm, .mov)
    │
    ├── ffmpeg (컨테이너 내)
    │     └── 1fps 프레임 샘플링 → JPEG 배열
    │           └── 멀티모달 embed → vec0
    │
    └── ffmpeg audio extract → PCM
          └── Whisper (Ollama: whisper 모델)
                └── 전사 텍스트 → chunk_fixed() → FTS5 + vec0
```

### 제약

- ffmpeg 미설치 시 graceful skip (컨테이너에는 기본 설치)
- 영상 길이 제한 권장: 10분 (프레임 수 상한)
- Whisper 미설치 시 전사 없이 프레임 embed만 수행

---

## DB 스키마 변경 (ReferenceStore)

```sql
-- ref_documents에 media_type 추가
ALTER TABLE ref_documents ADD COLUMN media_type TEXT NOT NULL DEFAULT 'text';
-- 'text' | 'image' | 'video'

-- 이미지/영상 전용 메타
CREATE TABLE IF NOT EXISTS ref_media (
  chunk_id    TEXT PRIMARY KEY REFERENCES ref_chunks(chunk_id) ON DELETE CASCADE,
  file_path   TEXT NOT NULL,
  media_type  TEXT NOT NULL,  -- 'image' | 'video_frame' | 'video_transcript'
  timestamp_s REAL,           -- 영상 프레임 타임스탬프 (초)
  alt_text    TEXT            -- 이미지 설명 (사용자 입력 가능)
);
```

---

## 구현 순서

### Phase 1 (텍스트 우선, 이번 구현)

1. `src/utils/doc-extractor.ts` — `extract_text(buf, ext)` 유틸 (PDF/DOCX/HWPX)
2. `ReferenceStore` 수정:
   - `sync()` async 전환
   - `SUPPORTED_EXTENSIONS`에 `.pdf`, `.docx`, `.hwpx` 추가
   - `chunk_text()` async 전환 + 바이너리 분기
3. `npm install mammoth adm-zip`
4. `src/services/skill-ref-store.ts` — SkillRefStore (ReferenceStoreLike 구현)
5. `agent-core.ts` — SkillRefStore 생성 + embed 연결
6. `context.service.ts` — `_build_skill_reference_context()` 추가
7. 테스트: `tests/services/doc-extractor.test.ts`, `tests/services/skill-ref-store.test.ts`

### Phase 2 (이미지)

8. `EmbedFn` 타입 확장 (멀티모달 input 허용)
9. `ReferenceStore` — 이미지 경로 인덱싱 + vec0 전용 저장
10. `ref_media` 테이블 추가

### Phase 3 (영상)

11. `src/utils/video-extractor.ts` — ffmpeg 프레임 추출 + Whisper 전사
12. `ReferenceStore` — 영상 처리 파이프라인 연결

---

## 검증

```
# Phase 1 텍스트
workspace/references/report.pdf 업로드
→ sync() → PDF 텍스트 추출 → 청킹 → 임베딩
→ "보고서 요약" 쿼리 → 관련 청크 시스템 프롬프트 주입

# Phase 1b Skills
"PDF 만들어줘" 요청
→ SkillRefStore.search("PDF 만들어줘", { doc_filter: "file-maker" })
→ file-maker/references/pdf.md 관련 청크 주입

# Phase 2 이미지
workspace/references/diagram.png 업로드 (멀티모달 모델 설정 시)
→ 이미지 임베딩 → "아키텍처 다이어그램" 쿼리 → 이미지 경로 응답
```
