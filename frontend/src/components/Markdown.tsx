import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

import { cn } from '@/lib/utils'

const remarkPlugins = [remarkGfm, remarkMath]
const rehypePlugins = [[rehypeKatex, { strict: false, throwOnError: false }] as const]

export const Markdown = memo(function Markdown({ children, className, inline }: { children: string; className?: string; inline?: boolean }) {
  if (!children?.trim()) return null
  return (
    <div className={cn('prose-md', inline && '[&_p]:inline [&_p]:m-0', className)}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins as never} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
})

const components = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
}
