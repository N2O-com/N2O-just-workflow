"use client";

import "@assistant-ui/react-markdown/styles/dot.css";

import {
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { memo } from "react";

const MarkdownTextImpl = () => {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      className="aui-md"
      components={defaultComponents}
    />
  );
};

export const MarkdownText = memo(MarkdownTextImpl);

const defaultComponents = memoizeMarkdownComponents({
  h1: ({ ...props }) => (
    <h1
      className="aui-md-h1 mb-4 mt-6 text-2xl font-bold first:mt-0"
      {...props}
    />
  ),
  h2: ({ ...props }) => (
    <h2
      className="aui-md-h2 mb-3 mt-5 text-xl font-semibold first:mt-0"
      {...props}
    />
  ),
  h3: ({ ...props }) => (
    <h3
      className="aui-md-h3 mb-2 mt-4 text-lg font-semibold first:mt-0"
      {...props}
    />
  ),
  p: ({ ...props }) => (
    <p
      className="aui-md-p my-2 leading-relaxed first:mt-0 last:mb-0"
      {...props}
    />
  ),
  ul: ({ ...props }) => (
    <ul className="aui-md-ul my-2 list-disc pl-6" {...props} />
  ),
  ol: ({ ...props }) => (
    <ol className="aui-md-ol my-2 list-decimal pl-6" {...props} />
  ),
  li: ({ ...props }) => (
    <li className="aui-md-li my-0.5" {...props} />
  ),
  a: ({ ...props }) => (
    <a
      className="aui-md-a text-primary underline underline-offset-2"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
  blockquote: ({ ...props }) => (
    <blockquote
      className="aui-md-blockquote my-2 border-l-2 border-border pl-4 text-muted-foreground"
      {...props}
    />
  ),
  strong: ({ ...props }) => (
    <strong className="aui-md-strong font-semibold" {...props} />
  ),
  em: ({ ...props }) => <em className="aui-md-em italic" {...props} />,
  pre: ({ ...props }) => (
    <pre
      className="aui-md-pre my-2 overflow-x-auto rounded-md border border-border bg-muted/50 p-3"
      {...props}
    />
  ),
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    return (
      <code
        className={
          !isCodeBlock
            ? "aui-md-inline-code rounded border border-border/50 bg-muted/50 px-1 py-0.5 font-mono text-[0.85em]"
            : className
        }
        {...props}
      />
    );
  },
  table: ({ ...props }) => (
    <div className="my-2 overflow-x-auto rounded-md border border-border">
      <table className="aui-md-table w-full text-sm" {...props} />
    </div>
  ),
  thead: ({ ...props }) => (
    <thead className="aui-md-thead border-b border-border bg-muted/30" {...props} />
  ),
  th: ({ ...props }) => (
    <th
      className="aui-md-th px-3 py-1.5 text-left text-xs font-medium"
      {...props}
    />
  ),
  td: ({ ...props }) => (
    <td className="aui-md-td px-3 py-1.5 text-xs" {...props} />
  ),
  tr: ({ ...props }) => (
    <tr className="aui-md-tr border-b border-border last:border-0" {...props} />
  ),
  hr: ({ ...props }) => (
    <hr className="aui-md-hr my-4 border-border" {...props} />
  ),
});
