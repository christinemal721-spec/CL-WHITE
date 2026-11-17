import { createElement, memo, useLayoutEffect, useRef, type ReactNode } from 'react'
import clsx from 'clsx'
import type {
  BlockContent,
  DefinitionContent,
  List as ListNode,
  PhrasingContent,
  RootContent,
  Table as TableNode,
} from 'mdast'
import { CitationLink } from '../search/CitationLink.js'
import { CodeBlock } from './CodeBlock.js'
import { ImageAsLink, Link } from './Link.js'
import { InlineMath, MathBlock } from './MathFormula.js'

/** 回答里允许出现的 HTML 标签；属性一律去掉（details 的 open 除外） */
const SAFE_TAGS = new Set([
  'details', 'summary', 'div', 'p', 'span', 'br', 'hr', 'center',
  'b', 'strong', 'i', 'em', 'u', 'ins', 'mark', 'kbd', 'small', 'del', 's', 'strike', 'sup', 'sub',
  'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
])
const KEEP_ATTRIBUTES = new Set(['open', 'colspan', 'rowspan'])

/** 只由安全标签组成的 HTML 转成 React 元素；含其它标签（script、img、input…）返回 null，按原文显示 */
const toSafeHtml = (value: string): ReactNode | null => {
  const body = new DOMParser().parseFromString(value, 'text/html').body
  let safe = true
  const convert = (node: ChildNode, key: number): ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null
    }
    const element = node as Element
    const tag = element.tagName.toLowerCase()
    if (!SAFE_TAGS.has(tag)) {
      safe = false
      return null
    }
    const props: Record<string, unknown> = { key }
    for (const attribute of element.attributes) {
      if (KEEP_ATTRIBUTES.has(attribute.name)) {
        props[attribute.name === 'colspan' ? 'colSpan' : attribute.name === 'rowspan' ? 'rowSpan' : attribute.name] =
          attribute.name === 'open' ? true : attribute.value
      }
    }
    const children = [...element.childNodes].map(convert)
    return tag === 'br' || tag === 'hr' ? createElement(tag, props) : createElement(tag, props, ...children)
  }
  const result = [...body.childNodes].map(convert)
  return safe ? result : null
}

const Html = memo(function Html({ value, block }: { value: string; block?: boolean }) {
  if (/^<br\s*\/?>$/i.test(value.trim())) {
    return <br />
  }
  if (block) {
    const safe = toSafeHtml(value)
    if (safe !== null) {
      return <div className="ds-markdown-html-block">{safe}</div>
    }
  }
  return <span className="ds-markdown-html">{value}</span>
})

const List = memo(function List({ node, loading }: { node: ListNode; loading: boolean }) {
  const ListTag = node.ordered ? 'ol' : 'ul'
  return (
    <ListTag start={node.ordered ? node.start || undefined : undefined}>
      {node.children.map((child, index) => {
        // GFM: task item 的 checked 为 boolean；普通 listItem 为 null
        const checked = child.checked
        const isTaskItem = typeof checked === 'boolean'
        return (
          <li key={index} className={isTaskItem ? 'ds-markdown-task-list-item' : undefined}>
            {isTaskItem ? (
              // □ U+25A1 / ☑ U+2611
              <span className="ds-markdown-task-checkbox">{checked ? '☑  ' : '□  '}</span>
            ) : null}
            <MarkdownBlockContentOrDefinitionContent nodes={child.children} loading={loading} />
          </li>
        )
      })}
    </ListTag>
  )
})

const Table = memo(function Table({ node }: { node: TableNode }) {
  const columnCount = node.children[0]?.children.length
  return (
    <div className="markdown-table-wrapper">
      <table>
        {node.children[0] ? (
          <thead>
            <tr>
              {node.children[0].children.map((cell, cellIndex) => {
                return (
                  <th key={cellIndex}>
                    <MarkdownPhrasingContent nodes={cell.children} />
                  </th>
                )
              })}
            </tr>
          </thead>
        ) : null}
        {node.children[1] ? (
          <tbody>
            {node.children.slice(1).map((row, rowIndex) => {
              const curColumnCount = row.children.length || 0
              return (
                <tr key={rowIndex}>
                  {row.children.map((cell, cellIndex) => {
                    return (
                      <td key={cellIndex}>
                        <MarkdownPhrasingContent nodes={cell.children} />
                      </td>
                    )
                  })}
                  {/* 补齐到列数 */}
                  {Array.from({ length: columnCount - curColumnCount }).map((_, idx) => (
                    <td key={`ptd_${idx}`} />
                  ))}
                </tr>
              )
            })}
          </tbody>
        ) : null}
      </table>
    </div>
  )
})

const MarkdownPhrasingContent = memo(function MarkdownPhrasingContent({
  nodes,
}: {
  nodes: PhrasingContent[]
}) {
  return (
    <>
      {nodes.map((node, index) => {
        return <MarkdownPhrasingContentItem key={index} node={node} />
      })}
    </>
  )
})

const MarkdownPhrasingContentItem = memo(function MarkdownPhrasingContentItem({
  node,
}: {
  node: PhrasingContent
}) {
  switch (node.type) {
    case 'inlineMath':
      return <InlineMath value={node.value} />
    case 'break':
      return <br />
    case 'emphasis':
      return (
        <em>
          <MarkdownPhrasingContent nodes={node.children} />
        </em>
      )
    case 'image':
      return <ImageAsLink node={node} />
    case 'html':
      return <Html value={node.value} />
    case 'inlineCode':
      return <code>{node.value}</code>
    case 'link':
      return (
        <Link node={node}>
          <MarkdownPhrasingContent nodes={node.children} />
        </Link>
      )
    case 'strong':
      return (
        <strong>
          <MarkdownPhrasingContent nodes={node.children} />
        </strong>
      )
    case 'text':
      return <TextContent>{node.value}</TextContent>
    case 'citation':
      return <CitationLink source={node.source} />
    case 'htmlInline':
      return createElement(node.tag, null, <MarkdownPhrasingContent nodes={node.children} />)
    case 'strike':
      return (
        <del>
          <MarkdownPhrasingContent nodes={node.children} />
        </del>
      )
    default:
      // 脚注、引用式链接已在解析时换成文本
      return null
  }
})

// 按 \n 拆行插 <br>：源文每个换行（含软换行）都渲染为视觉换行
const TextContent = memo(function TextContent({ children }: { children: string }) {
  const result: ReactNode[] = []
  children.split(/\r?\n/).forEach((line, index) => {
    result.push(<span key={index + 's'}>{line}</span>, <br key={index + 'br'} />)
  })
  result.pop()
  return result
})

const MarkdownBlockContentOrDefinitionContent = memo(
  function MarkdownBlockContentOrDefinitionContent({
    nodes,
    loading,
  }: {
    nodes: Array<BlockContent | DefinitionContent>
    loading: boolean
  }) {
    return nodes.map((node, index) => {
      switch (node.type) {
        case 'math':
          return <MathBlock key={index} value={node.value} />
        case 'thematicBreak':
          return <hr key={index} />
        case 'blockquote':
          return (
            <blockquote key={index}>
              <MarkdownBlockContentOrDefinitionContent nodes={node.children} loading={loading} />
            </blockquote>
          )
        case 'html':
          return <Html key={index} value={node.value} block />
        case 'heading':
          return node.children.length === 0
            ? null
            : createElement(
                `h${node.depth}`,
                { key: index },
                <MarkdownPhrasingContent nodes={node.children} />
              )
        case 'paragraph':
          return (
            <p key={index} className="ds-markdown-paragraph">
              <MarkdownPhrasingContent nodes={node.children} />
            </p>
          )
        case 'code':
          return (
            <CodeBlock
              key={index}
              code={node.value}
              infostring={node.lang || 'text'}
              loading={loading}
            />
          )
        case 'table':
          return <Table node={node} key={index} />
        case 'list':
          return <List key={index} node={node} loading={loading} />
        default:
          // 脚注与定义已在解析时换成段落
          return null
      }
    })
  }
)

/** 顶层块：原文 + 解析后的节点 */
export type MarkdownBlock = {
  raw: string
  node: RootContent
}

const hasFence = (raw: string) => raw.includes('```') || raw.includes('~~~')

/**
 * 单个顶层块。原文没变就不重渲染：
 * 流式输出时每次都会重新解析出新的节点对象，单靠 memo 拦不住，
 * 这里按原文比较，已经写完的段落、公式、代码块不再跟着重绘。
 * 只有含代码块的块才关心 loading（Mermaid 等结束后才渲染）。
 */
const RootBlock = memo(
  function RootBlock({
    block,
    loading,
  }: {
    block: MarkdownBlock
    loading: boolean
    parseKey: unknown
  }) {
    return (
      <MarkdownBlockContentOrDefinitionContent
        nodes={[block.node as BlockContent | DefinitionContent]}
        loading={loading}
      />
    )
  },
  (prev, next) =>
    prev.parseKey === next.parseKey &&
    prev.block.raw === next.block.raw &&
    (prev.loading === next.loading || !hasFence(next.block.raw))
)

export const MarkdownAstRenderer = memo(function MarkdownAstRenderer({
  blocks,
  parseKey,
  onUpdate,
  className,
  loading = false,
}: {
  blocks: MarkdownBlock[]
  /** 解析选项（来源、是否禁用链接）的标识；变化时所有块重渲染 */
  parseKey: unknown
  className?: string
  loading?: boolean
  /**
   * layoutEffect 之后触发 -> 进行页面滚动
   */
  onUpdate: () => void
}) {
  const onUpdateRef = useRef<() => void>(() => 0)
  onUpdateRef.current = onUpdate
  useLayoutEffect(() => {
    onUpdateRef.current()
  }, [blocks])

  return (
    <div className={clsx('ds-markdown', loading && 'ds-streaming', className)}>
      {blocks.map((block, index) => (
        <RootBlock key={index} block={block} loading={loading} parseKey={parseKey} />
      ))}
    </div>
  )
})
