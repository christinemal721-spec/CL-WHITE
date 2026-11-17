import type { MarkdownBlock } from '../../components/markdown/MarkdownAstRenderer.js'
import type { Source } from '../chat/view.js'
import { normalizeMarkdown } from './normalize.js'
import { toMdAst } from './parse.js'

type Options = { sources: Source[] | undefined; disableLink: boolean }

/** 上一次解析的结果，供流式输出时增量解析 */
export type BlockCache = {
  input: string
  options: Options
  blocks: MarkdownBlock[]
  /** 每个块所在行的起始位置（绝对偏移），增量解析从这里切开 */
  starts: number[]
}

/**
 * 链接 / 脚注定义会影响后文的解析（[文字][标签] 是否成为引用），
 * 稳定部分里出现疑似定义（含列表、引用里的）时退回完整解析。
 */
const DEFINITION = /\[[^\]\n]+\]:/

/** 末尾这几块每次都重新解析：最后一块还在写，倒数第二块可能被新内容并入 */
const REPARSE_TAIL = 2

const parseBlocks = (input: string, base: number, options: Options) => {
  const ast = toMdAst(input, options)
  const blocks: MarkdownBlock[] = []
  const starts: number[] = []
  for (const node of ast.children) {
    const from = node.position?.start.offset ?? 0
    const to = node.position?.end.offset ?? input.length
    blocks.push({ node, raw: input.slice(from, to) })
    // 从行首切，保留列表、引用的缩进
    starts.push(base + input.lastIndexOf('\n', from - 1) + 1)
  }
  return { blocks, starts }
}

/**
 * 把 Markdown 解析成顶层块。
 *
 * incremental 为 true（流式输出中）且新内容是在上次基础上追加时，
 * 已经稳定的块直接复用，只重新解析末尾几块；长回复不再每次从头解析。
 * 输出结束后传 false 做一次完整解析，保证最终结果和一次性解析完全一致。
 */
export const toMarkdownBlocks = (
  input: string,
  options: Options,
  previous: BlockCache | null,
  incremental: boolean
): BlockCache => {
  // 先统一改写公式写法；之后的切分、位置都以改写后的文本为准
  input = normalizeMarkdown(input)
  if (
    incremental &&
    previous &&
    previous.options.sources === options.sources &&
    previous.options.disableLink === options.disableLink &&
    previous.blocks.length > REPARSE_TAIL
  ) {
    let keep = previous.blocks.length - REPARSE_TAIL
    // 同一行拆出来的几块（文字中间的 $$公式$$）要一起重新解析，不能从中间切
    while (keep > 0 && previous.starts[keep - 1] === previous.starts[keep]) {
      keep--
    }
    const cut = previous.starts[keep]
    const stable = previous.input.slice(0, cut)
    if (input.length >= cut && input.startsWith(stable) && !DEFINITION.test(stable)) {
      const tail = parseBlocks(input.slice(cut), cut, options)
      return {
        input,
        options,
        blocks: previous.blocks.slice(0, keep).concat(tail.blocks),
        starts: previous.starts.slice(0, keep).concat(tail.starts),
      }
    }
  }
  return { input, options, ...parseBlocks(input, 0, options) }
}
