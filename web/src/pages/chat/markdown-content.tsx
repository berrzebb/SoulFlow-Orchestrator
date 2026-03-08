import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Components } from "react-markdown";
import type { Pluggable } from "unified";
import "highlight.js/styles/github-dark.min.css";

/** highlight.js가 추가하는 클래스명을 sanitize에서 허용 */
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
    span: [...(defaultSchema.attributes?.span ?? []), "className"],
  },
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "del", "input",
  ],
};

const SAFE_URL_RE = /^https?:\/\//i;

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
};

const REMARK_PLUGINS: Pluggable[] = [remarkGfm];
const REHYPE_PLUGINS: Pluggable[] = [rehypeHighlight, [rehypeSanitize, SANITIZE_SCHEMA]];

export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="chat-md">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
