/**
 * Markdown rendering for assistant messages. Plain react-markdown over GFM,
 * with quiet code blocks (no syntax highlighting in this iteration).
 * @module desktop/renderer/components/Markdown
 */

import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function CodeBlock(props: React.JSX.IntrinsicElements['pre']): React.JSX.Element {
  const { children, ...rest } = props
  return (
    <pre className="md-pre" {...rest}>
      {children}
    </pre>
  )
}

function InlineCode(props: React.JSX.IntrinsicElements['code']): React.JSX.Element {
  const { className, children } = props
  const isBlock = className?.includes('language-') ?? false
  return isBlock
    ? <code className={className}>{children}</code>
    : <code className="md-code">{children}</code>
}

export const Markdown = memo(function Markdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: CodeBlock,
          code: InlineCode,
          a: props => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
