"use client";
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Props = {
  content: string;
  className?: string;
};

export default function Markdown({ content, className }: Props) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node, ...props }) => <h1 className="text-xl font-semibold mt-4 mb-2" {...props} />,
          h2: ({ node, ...props }) => <h2 className="text-lg font-semibold mt-4 mb-2" {...props} />,
          h3: ({ node, ...props }) => <h3 className="text-base font-semibold mt-3 mb-1" {...props} />,
          p: ({ node, ...props }) => <p className="my-2 leading-relaxed" {...props} />,
          ul: ({ node, ...props }) => <ul className="list-disc pl-6 my-2 space-y-1" {...props} />,
          ol: ({ node, ...props }) => <ol className="list-decimal pl-6 my-2 space-y-1" {...props} />,
          li: ({ node, ...props }) => <li className="marker:text-gray-500" {...props} />,
          blockquote: ({ node, ...props }) => (
            <blockquote className="border-l-4 border-gray-700 pl-4 italic text-gray-300 my-3" {...props} />
          ),
          code: ({ className, children, ...props }) => (
            <code
              className={"bg-gray-900/60 rounded px-1.5 py-0.5 text-[0.85em] " + (className || "")}
              {...props}
            >
              {children}
            </code>
          ),
          a: ({ node, ...props }) => (
            <a className="text-brand hover:underline" target="_blank" rel="noreferrer" {...props} />
          ),
          table: ({ node, ...props }) => (
            <div className="overflow-x-auto my-3">
              <table className="min-w-full border border-gray-800" {...props} />
            </div>
          ),
          th: ({ node, ...props }) => <th className="border border-gray-800 px-2 py-1 bg-gray-900" {...props} />,
          td: ({ node, ...props }) => <td className="border border-gray-800 px-2 py-1" {...props} />,
          hr: () => <hr className="border-gray-800 my-4" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
