import type {
  Node as MdAstNode,
  Nodes,
  Paragraph,
  Parent,
  PhrasingContent,
  RootContent,
  Root,
  Text,
} from 'mdast'
import { findAndReplace } from 'mdast-util-find-and-replace'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown, type InlineMath, type Math } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-llm-math'
import type { Source } from '../chat/view.js'

/** 正文里的 [citation:N]，已换成对应来源 */
export interface CitationNode extends MdAstNode {
  type: 'citation'
  source: Source
}

/** 正文里允许的少量 HTML 行内标签（<sup>2</sup> 之类），换成对应元素 */
export interface HtmlInlineNode extends MdAstNode {
  type: 'htmlInline'
  tag: HtmlInlineTag
  children: PhrasingContent[]
}

/** ~~删除线~~ 只认两个波浪号；单个 ~ 多是「1~2 天」这种范围 */
export interface StrikeNode extends MdAstNode {
  type: 'strike'
  children: PhrasingContent[]
}

declare module 'mdast' {
  interface RootContentMap {
    citation: CitationNode
    htmlInline: HtmlInlineNode
    strike: StrikeNode
  }

  interface PhrasingContentMap {
    citation: CitationNode
    htmlInline: HtmlInlineNode
    strike: StrikeNode
  }
}

const HTML_INLINE_TAGS = ['sup', 'sub', 'u', 'ins', 'mark', 'kbd', 'small', 'del', 's', 'strike'] as const
export type HtmlInlineTag = (typeof HTML_INLINE_TAGS)[number]
/** 这几个标签直接换成 Markdown 自己的加粗、斜体 */
const HTML_AS_MARKDOWN: Record<string, 'strong' | 'emphasis'> = {
  b: 'strong',
  strong: 'strong',
  i: 'emphasis',
  em: 'emphasis',
}
const OPEN_TAG = /^<([a-z]+)(?:\s[^<>]*)?>$/i
const CLOSE_TAG = /^<\/([a-z]+)\s*>$/i

/** 把同一段里成对的 <sup>…</sup> 等换成对应节点；不认识或不成对的标签保持原样显示 */
const pairHtmlTags = (children: PhrasingContent[]): PhrasingContent[] => {
  const result: PhrasingContent[] = []
  for (let i = 0; i < children.length; i++) {
    const node = children[i]
    const tag = node.type === 'html' ? node.value.match(OPEN_TAG)?.[1]?.toLowerCase() : undefined
    const known = tag && (HTML_AS_MARKDOWN[tag] || (HTML_INLINE_TAGS as readonly string[]).includes(tag))
    if (!tag || !known) {
      result.push(node)
      continue
    }
    let depth = 0
    let close = -1
    for (let j = i + 1; j < children.length; j++) {
      const other = children[j]
      if (other.type !== 'html') {
        continue
      }
      if (other.value.match(OPEN_TAG)?.[1]?.toLowerCase() === tag) {
        depth++
      } else if (other.value.match(CLOSE_TAG)?.[1]?.toLowerCase() === tag) {
        if (depth === 0) {
          close = j
          break
        }
        depth--
      }
    }
    if (close === -1) {
      result.push(node)
      continue
    }
    const inner = pairHtmlTags(children.slice(i + 1, close))
    const markdownType = HTML_AS_MARKDOWN[tag]
    result.push(
      markdownType
        ? ({ type: markdownType, children: inner } as PhrasingContent)
        : { type: 'htmlInline', tag: tag as HtmlInlineTag, children: inner }
    )
    i = close
  }
  return result
}

/** 汉字、假名、韩文及全角标点 */
const CJK = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/

/**
 * 标准 Markdown 规定：** 紧挨着标点、另一侧紧挨着文字时不算加粗，
 * 所以「**“你好”**然后」「**标题：**内容」「**《三体》**很好看」在中文里整段认不出来。
 * 解析器没认出来的这些，在纯文本里补认一遍：
 * - **加粗** 都补；前后紧挨英文字母数字的不补（如 2**10 是乘方）
 * - __加粗__ 和 *斜体* 只在内容含中文时补，避免误伤 __init__、a*b*c
 */
const EMPHASIS =
  /(?<![A-Za-z0-9*\\])\*\*(?![\s*])([^\n]*?[^\s\\])\*\*(?![A-Za-z0-9*])|(?<![A-Za-z0-9_\\])__(?![\s_])([^\n]*?[^\s\\])__(?![A-Za-z0-9_])|(?<![A-Za-z0-9*\\])\*(?![\s*])([^*\n]*?[^\s*\\])\*(?![A-Za-z0-9*])/g

const fixEmphasis = (value: string): PhrasingContent[] => {
  if (!value.includes('*') && !value.includes('__')) {
    return [text(value)]
  }
  const result: PhrasingContent[] = []
  let last = 0
  for (const match of value.matchAll(EMPHASIS)) {
    const [whole, bold, underline, italic] = match
    const inner = bold ?? underline ?? italic
    if ((underline !== undefined || italic !== undefined) && !CJK.test(inner)) {
      continue
    }
    if (match.index > last) {
      result.push(text(value.slice(last, match.index)))
    }
    result.push({
      type: italic !== undefined ? 'emphasis' : 'strong',
      children: fixEmphasis(inner),
    } as PhrasingContent)
    last = match.index + whole.length
  }
  if (last === 0) {
    return [text(value)]
  }
  if (last < value.length) {
    result.push(text(value.slice(last)))
  }
  return result
}

/** 去掉 \text{…} 等本来就放文字的命令后，公式里还有中文：多半是 $5 到 $10 这种金额被误认成公式 */
const TEXT_COMMANDS = /\\(?:text\w*|mbox|mathrm|operatorname|ce|pu)\s*\{[^{}]*\}/g
const looksLikeProse = (value: string) =>
  // 有 \\命令 的一定是公式（如 $\\colorbox{…}{中文}$），只有纯文字加中文的才可能是金额
  !/\\[A-Za-z]/.test(value) && CJK.test(value.replace(TEXT_COMMANDS, ''))

const text = (value: string): Text => ({ type: 'text', value })

/**
 * 解析正文（调用方先用 normalizeMarkdown 处理过），并把渲染器不单独处理的节点提前换掉，渲染时无需再读原文：
 * - 传入 sources 时，[citation:N] 换成角标节点，找不到来源的直接去掉
 * - disableLink 时链接只保留文字
 * - 删除线保留原样的 ~ 定界符，脚注、引用式链接与定义显示原文
 */
export function toMdAst(
  input: string,
  { sources, disableLink }: { sources: Source[] | undefined; disableLink: boolean }
): Root {
  const ast = fromMarkdown(input, {
    extensions: [
      // codeIndented 语法导致有前导空格的列表无法正常渲染
      { ...gfm(), disable: { null: ['codeIndented'] } },
      math({ singleDollarTextMath: true }),
    ],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  })
  if (sources) {
    const sourcesByIndex = new Map(sources.map((source) => [source.index, source]))
    findAndReplace(
      ast,
      [
        /\[citation:(\d+)\]/g,
        (_: string, index: string): CitationNode | '' => {
          const source = sourcesByIndex.get(Number(index))
          return source ? { type: 'citation', source } : ''
        },
      ],
      { ignore: ['linkReference'] }
    )
  }
  const raw = (node: Nodes) => input.slice(node.position?.start.offset, node.position?.end.offset)
  // 先处理子节点，再按需把当前节点换成若干节点
  const simplify = (node: Nodes): Nodes[] => {
    if ('children' in node) {
      ;(node as Parent).children = node.children.flatMap(simplify) as RootContent[]
    }
    switch (node.type) {
      case 'link':
        return disableLink ? node.children : [node]
      case 'delete': {
        // 解析器保证首尾定界符等长；只有 ~~ 才是删除线
        const delimiter = raw(node).match(/^~+/)?.[0] ?? ''
        return delimiter === '~~'
          ? [{ type: 'strike', children: node.children }]
          : [text(delimiter), ...node.children, text(delimiter)]
      }
      case 'text':
        return fixEmphasis(node.value)
      case 'inlineMath': {
        const source = raw(node)
        // 金额、命令行提示符等被误认成公式：还原成文字
        if (source.startsWith('$') && !source.startsWith('$$') && looksLikeProse(node.value)) {
          return [text(source)]
        }
        // 文献角标 \[1\]
        if (source.startsWith('\\[') && /^\s*\d+(?:\s*[,，、\-–]\s*\d+)*\s*$/.test(node.value)) {
          return [text(`[${node.value.trim()}]`)]
        }
        return [node]
      }
      case 'paragraph':
        return splitDisplayMath(node, raw)
      case 'heading':
      case 'tableCell':
        node.children = pairHtmlTags(node.children)
        return [node]
      case 'footnoteReference':
      case 'imageReference':
      case 'linkReference':
        return [text(raw(node))]
      case 'footnoteDefinition':
      case 'definition':
        // 保留原文位置：按块增量解析依赖顶层节点的位置切分
        return [{ type: 'paragraph', children: [text(raw(node))], position: node.position }]
      default:
        return [node]
    }
  }
  simplify(ast)
  return ast
}

/** 一串相邻节点合起来的位置 */
const spanOf = (nodes: PhrasingContent[]) => {
  const start = nodes[0]?.position?.start
  const end = nodes.at(-1)?.position?.end
  return start && end ? { start, end } : undefined
}

/** $$…$$、\[…\] 写在一段文字中间时，按公式块单独成行显示，而不是缩成行内小公式 */
const splitDisplayMath = (node: Paragraph, raw: (node: Nodes) => string): Nodes[] => {
  node.children = pairHtmlTags(node.children)
  const isDisplay = (child: PhrasingContent): child is InlineMath =>
    child.type === 'inlineMath' &&
    // $$…$$、\[…\]，以及用单个 $ 包着的 LaTeX 卡片
    (/^(\$\$|\\\[)/.test(raw(child)) || /\\(?:colorbox|fcolorbox|fbox)\b|\\begin\{tabular/.test(child.value))
  if (!node.children.some(isDisplay)) {
    return [node]
  }
  const result: Nodes[] = []
  let pending: PhrasingContent[] = []
  const flush = () => {
    // 去掉公式两侧多出来的空白和换行
    const first = pending[0]
    const last = pending.at(-1)
    if (first?.type === 'text') {
      first.value = first.value.replace(/^\s+/, '')
    }
    if (last?.type === 'text') {
      last.value = last.value.replace(/\s+$/, '')
    }
    pending = pending.filter((child) => child.type !== 'text' || child.value)
    if (pending.length) {
      result.push({
        type: 'paragraph',
        children: pending,
        position: spanOf(pending) ?? node.position,
      })
    }
    pending = []
  }
  for (const child of node.children) {
    if (isDisplay(child)) {
      flush()
      result.push({ type: 'math', value: child.value.trim(), position: child.position } satisfies Math)
    } else {
      pending.push(child)
    }
  }
  flush()
  return result
}
