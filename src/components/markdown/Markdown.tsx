import { memo, useMemo, useRef } from 'react'
import type { Source } from '../../services/chat/view.js'
import { toMarkdownBlocks, type BlockCache } from '../../services/markdown/blocks.js'
import { useScrollToBottom } from '../messages/scrollContext.js'
import { MarkdownAstRenderer } from './MarkdownAstRenderer.js'
import { useSmoothStream } from './useSmoothStream.js'
import { useThrottleMarkdownRender } from './useThrottleMarkdownRender.js'
import './markdown.css'
import './highlight.css'

/**
 * 渲染链路：匀速吐字 → 节流 → 按顶层块（增量）解析 → 按块渲染，原文没变的块不重绘。
 * 传入 sources 时把正文里的 [citation:N] 渲染为角标。
 */
export const Markdown = memo(function Markdown({
  content,
  loading,
  cacheKey,
  className,
  disableLink,
  sources,
}: {
  content: string
  loading: boolean
  cacheKey: string
  className?: string
  disableLink: boolean
  sources?: Source[]
}) {
  const scrollToBottom = useScrollToBottom()
  const smoothed = useSmoothStream(content, loading)
  const throttledMarkdown = useThrottleMarkdownRender(smoothed, loading)
  const cacheRef = useRef<BlockCache | null>(null)
  const blocks = useMemo(() => {
    if (!throttledMarkdown) {
      cacheRef.current = null
      return null
    }
    const next = toMarkdownBlocks(
      throttledMarkdown,
      { sources, disableLink },
      cacheRef.current,
      loading
    )
    cacheRef.current = next
    return next.blocks
  }, [throttledMarkdown, sources, disableLink, loading])
  const parseKey = useMemo(() => ({ sources, disableLink }), [sources, disableLink])
  return blocks ? (
    <MarkdownAstRenderer
      key={cacheKey}
      className={className}
      blocks={blocks}
      parseKey={parseKey}
      loading={loading}
      onUpdate={scrollToBottom}
    />
  ) : null
})
