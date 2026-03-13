import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Components } from "react-markdown";
import type { Pluggable } from "unified";
import "highlight.js/styles/github-dark.min.css";
import "katex/dist/katex.min.css";
import { MapBlock } from "./map-embed.js";

/** highlight.js + KaTeX가 추가하는 클래스명/인라인 스타일을 sanitize에서 허용 */
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
    span: [...(defaultSchema.attributes?.span ?? []), "className", "style"],
    div:  [...(defaultSchema.attributes?.div  ?? []), "className", "style"],
  },
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "del", "input",
  ],
};

/** AI 모델이 생성하는 LaTeX 수식 구분자를 remark-math 호환 $$...$$ 형식으로 변환 */
const DISPLAY_MATH_RE = /\\\[([\s\S]*?)\\\]/g;          // 표준: \[...\]
const INLINE_MATH_RE = /\\\(([\s\S]*?)\\\)/g;           // 표준: \(...\)
/** AI 비표준 형식: 줄 전체가 [ ... ] 이고 \command 포함 */
const AI_DISPLAY_MATH_RE = /^\[ (.*?\\[a-zA-Z].*?) \]$/gm;

function preprocess_latex(content: string): string {
  // replace()에서 $$$$이 리터럴 $$, $1이 캡처그룹
  return content
    .replace(DISPLAY_MATH_RE, "\n$$$$\n$1\n$$$$\n")     // \[...\] → $$...$$
    .replace(INLINE_MATH_RE, "$$$1$$")                   // \(...\) → $...$
    .replace(AI_DISPLAY_MATH_RE, "\n$$$$\n$1\n$$$$\n"); // [ ... ] → $$...$$
}

const SAFE_URL_RE = /^https?:\/\//i;

/** map 코드블록을 Leaflet 지도로 렌더링 */
function MapCode({ className, children }: React.HTMLAttributes<HTMLElement>) {
  if (typeof className === "string" && className.includes("language-map")) {
    return <MapBlock raw={String(children).trim()} />;
  }
  return <code className={className}>{children}</code>;
}

/** 안전한 링크만 렌더링, javascript:/data: 등 차단 */
function SafeLink({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) {
  if (!href || !SAFE_URL_RE.test(href)) {
    return <span>{children}</span>;
  }
  return <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>{children} ↗</a>;
}

/** 외부 이미지 로드 제한 — URL만 텍스트로 표시 */
function SafeImage({ src, alt }: React.ImgHTMLAttributes<HTMLImageElement>) {
  if (!src || !SAFE_URL_RE.test(src)) return null;
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="chat-md__img-link">
      🖼 {alt || src}
    </a>
  );
}

const COMPONENTS: Components = {
  a: SafeLink as Components["a"],
  img: SafeImage as Components["img"],
  code: MapCode as Components["code"],
};

const REMARK_PLUGINS: Pluggable[] = [remarkGfm, remarkMath];
const REHYPE_PLUGINS: Pluggable[] = [
  rehypeHighlight,
  [rehypeKatex, { output: "html" }],
  [rehypeSanitize, SANITIZE_SCHEMA],
];

export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="chat-md">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={COMPONENTS}
      >
        {preprocess_latex(content)}
      </ReactMarkdown>
    </div>
  );
}
