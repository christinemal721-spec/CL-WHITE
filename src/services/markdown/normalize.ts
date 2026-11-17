/**
 * 解析前把模型常见、但标准 Markdown 认不出的公式写法改成能认的写法。
 * 只处理代码块以外的内容；输入只在末尾追加时，前面已处理的部分结果不变（流式增量解析依赖这一点）。
 *
 * - 单独一行的 `$$ 公式 $$` 拆成三行的公式块（否则会被当成行内公式，\tag 之类只能在公式块里用的命令会报错）
 * - `$$ 第一行` …… `最后一行 $$` 这种首尾和内容写在同一行的公式块，把 $$ 拆到单独一行
 * - 没有包在 $$ 里的 \begin{aligned} …… \end{aligned} 等公式环境，补上 $$
 * - 表格行里行内公式中的 |（如 $|x|$）换成 \vert，不再把表格切坏
 * - 模型用 LaTeX 画的卡片（\colorbox、\fbox、tabular…）没包 $$、或者包在 ```latex 代码块里时，按公式块显示
 * - 去掉零宽字符（BOM 等），它们夹在 $$ 前面会让公式块认不出来
 * - 公式块的 $$ 和文字写在同一行（「旁白 $$\colorbox…」「…}$$ 后文」）时，把 $$ 拆到单独一行
 */

const FENCE = /^\s*(`{3,}|~{3,})/

/** 只认这些公式环境；document、itemize 等排版环境不算 */
const MATH_ENVS = new Set([
  'aligned',
  'align',
  'align*',
  'alignat',
  'alignat*',
  'equation',
  'equation*',
  'gather',
  'gather*',
  'gathered',
  'cases',
  'matrix',
  'pmatrix',
  'bmatrix',
  'vmatrix',
  'Bmatrix',
  'Vmatrix',
  'smallmatrix',
  'array',
  'split',
  'multline',
  'multline*',
  'eqnarray',
  'eqnarray*',
  // KaTeX 不认 tabular，渲染前会转换成 array
  'tabular',
])

const BEGIN = /^\\begin\{([A-Za-z]+\*?)\}/

/** 行首是这些命令：模型在画 LaTeX 卡片 */
const CARD_START = /^\\(?:colorbox|fcolorbox|fbox|framebox|boxed)\s*\{/

/** ```latex 代码块里是卡片（而不是一份完整的 LaTeX 文档）时，直接渲染 */
const isLatexCard = (content: string) =>
  /\\(?:colorbox|fcolorbox|fbox|textcolor)\b|\\begin\{tabular\}/.test(content) &&
  !/\\(?:documentclass|usepackage)\b|\\begin\{document\}/.test(content)

/** 找 $$（跳过 \$$ 和行内代码 `…` 里的），找不到返回 -1 */
const findDollars = (line: string, from = 0) => {
  let code = false
  for (let i = from; i < line.length - 1; i++) {
    const char = line[i]
    if (char === '`') {
      code = !code
    } else if (char === '\\') {
      i++
    } else if (!code && char === '$' && line[i + 1] === '$') {
      return i
    }
  }
  return -1
}

const ZERO_WIDTH = /\uFEFF|\u200B|\u200C|\u200D|\u2060/g

/** 从 start 行开始，花括号配平到哪一行结束；没写完（流式中）返回 -1 */
const findBalanced = (lines: string[], start: number) => {
  let depth = 0
  for (let i = start; i < lines.length && i < start + 400; i++) {
    const line = lines[i]
    for (let j = 0; j < line.length; j++) {
      const char = line[j]
      if (char === '\\') {
        j++
      } else if (char === '{') {
        depth++
      } else if (char === '}') {
        depth--
      }
    }
    if (depth <= 0) {
      return i
    }
  }
  return -1
}

/** 表格行里的行内公式：不以空格开头结尾，避免把 `$5 | $10` 这种金额误当公式 */
const INLINE_MATH_IN_ROW = /\$(?!\s)([^$\n]*?[^\s$])\$/g

const fixTableRow = (line: string) =>
  line.replace(INLINE_MATH_IN_ROW, (whole, body: string) =>
    body.includes('|')
      ? `$${body.replace(/\\\|/g, '\\Vert{}').replace(/\|/g, '\\vert{}')}$`
      : whole
  )

/** 找到与第 start 行 \begin{name} 配对的 \end{name} 所在行；还没写到（流式中）返回 -1 */
const findEnd = (lines: string[], start: number, name: string) => {
  const begin = `\\begin{${name}}`
  const end = `\\end{${name}}`
  let depth = 0
  for (let i = start; i < lines.length && i < start + 400; i++) {
    const line = lines[i]
    if (FENCE.test(line)) {
      return -1
    }
    depth += line.split(begin).length - 1
    depth -= line.split(end).length - 1
    if (depth <= 0) {
      return i
    }
  }
  return -1
}

export const normalizeMarkdown = (input: string): string => {
  input = input.replace(ZERO_WIDTH, '')
  if (!input.includes('$') && !input.includes('\\')) {
    return input
  }
  const lines = input.split('\n')
  const out: string[] = []
  let fence: string | null = null
  /** 当前所在公式块的写法 */
  let math: '$$' | '\\[' | null = null
  /** 当前段落里有没写完的单个 $ 行内公式（跨行的 $…$），里面不再补 $$ */
  let inlineOpen = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const indent = line.slice(0, line.length - line.trimStart().length)
    const trimmed = line.trim()

    if (fence) {
      if (trimmed.startsWith(fence)) {
        fence = null
      }
      out.push(line)
      continue
    }
    const fenceMatch = line.match(FENCE)
    if (fenceMatch && !math) {
      // ```math 代码块，或画卡片的 ```latex 代码块：写完后按公式块显示
      const lang = trimmed.slice(fenceMatch[1].length).trim().toLowerCase()
      // 不带语言（或标成 text）的代码块里如果整块都是 LaTeX 卡片，也按卡片渲染：
      // 模型在同一个对话里会照着前文的写法输出，一旦用了这种包法，重新生成也一直是代码
      if (['math', 'latex', 'tex', 'katex', '', 'text', 'txt', 'plain', 'plaintext'].includes(lang)) {
        let close = -1
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim().startsWith(fenceMatch[1])) {
            close = j
            break
          }
        }
        // 代码块里自己又包了一层 $$ 或 \[ \] 时去掉，避免套两层
        let content = lines.slice(i + 1, close)
        while (content.length && !content[0].trim()) {
          content = content.slice(1)
        }
        while (content.length && !(content.at(-1) ?? '').trim()) {
          content = content.slice(0, -1)
        }
        if (
          content.length >= 2 &&
          ((content[0].trim() === '$$' && (content.at(-1) ?? '').trim() === '$$') ||
            (content[0].trim() === '\\[' && (content.at(-1) ?? '').trim() === '\\]'))
        ) {
          content = content.slice(1, -1)
        }
        const mathOnly = lang === 'math' || lang === 'katex'
        if (close !== -1 && (mathOnly || isLatexCard(content.join('\n')))) {
          out.push(`${indent}$$`, ...content, `${indent}$$`)
          i = close
          continue
        }
      }
      fence = fenceMatch[1]
      out.push(line)
      continue
    }

    if (math === '$$') {
      const close = findDollars(trimmed)
      if (trimmed === '$$') {
        math = null
        out.push(line)
      } else if (close > 0 && close < trimmed.length - 2) {
        // `…}$$ 后面还有文字`：$$ 收尾，文字另起一段
        out.push(
          `${indent}${trimmed.slice(0, close).trimEnd()}`,
          `${indent}$$`,
          '',
          `${indent}${trimmed.slice(close + 2).trimStart()}`
        )
        math = null
      } else if (trimmed.endsWith('$$') && !trimmed.endsWith('\\$$')) {
        // `最后一行 $$`
        out.push(`${indent}${trimmed.slice(0, -2).trimEnd()}`, `${indent}$$`)
        math = null
      } else {
        out.push(line)
      }
      continue
    }
    if (math === '\\[') {
      if (trimmed.includes('\\]')) {
        math = null
      }
      out.push(line)
      continue
    }

    // `旁白 $$` 或 `旁白 $$\colorbox{…`：这一行只有一个 $$，是公式块的开头，拆到单独一行
    // 只有后面确实是 LaTeX 才算：$$ 后紧跟 \命令，或 $$ 在行尾且下一行以 \ 开头；
    // 否则「用 $$ 包起来」这种正文会被误当成公式块
    const open = findDollars(trimmed)
    const after = open > 0 ? trimmed.slice(open + 2).trim() : ''
    const nextLine = lines.slice(i + 1).find((next) => next.trim())?.trim() ?? ''
    const looksLikeMath = after ? after.startsWith('\\') : nextLine.startsWith('\\')
    if (open > 0 && findDollars(trimmed, open + 2) === -1 && !inlineOpen && looksLikeMath) {
      const before = trimmed.slice(0, open).trimEnd()
      out.push(`${indent}${before}`, '', `${indent}$$`)
      if (after) {
        out.push(`${indent}${after}`)
      }
      math = '$$'
      continue
    }

    if (trimmed.startsWith('$$')) {
      const rest = trimmed.slice(2)
      const close = rest.indexOf('$$')
      if (close === -1) {
        // `$$` 或 `$$ 第一行`：公式块开始
        math = '$$'
        out.push(rest.trim() ? `${indent}$$` : line)
        if (rest.trim()) {
          out.push(`${indent}${rest.trim()}`)
        }
        continue
      }
      if (close === rest.length - 2 && rest.slice(0, close).trim()) {
        // 整行就是 `$$ 公式 $$`
        out.push(`${indent}$$`, `${indent}${rest.slice(0, close).trim()}`, `${indent}$$`)
        continue
      }
      out.push(line)
      continue
    }
    if (trimmed === '\\[' || (trimmed.startsWith('\\[') && !trimmed.includes('\\]'))) {
      math = '\\['
      out.push(line)
      continue
    }

    if (!trimmed) {
      inlineOpen = false
    }

    if (!inlineOpen && CARD_START.test(trimmed)) {
      const end = findBalanced(lines, i)
      if (end !== -1) {
        out.push(`${indent}$$`, ...lines.slice(i, end + 1), `${indent}$$`)
        i = end
        continue
      }
    }

    const env = trimmed.match(BEGIN)?.[1]
    if (env && MATH_ENVS.has(env) && !inlineOpen) {
      const end = findEnd(lines, i, env)
      if (end !== -1) {
        out.push(`${indent}$$`, ...lines.slice(i, end + 1), `${indent}$$`)
        i = end
        continue
      }
    }

    // 数一数这行里单独的 $（不算 $$ 和 \$），奇数个说明行内公式跨到了下一行
    const singles = line.replace(/\\\$|\$\$/g, '').split('$').length - 1
    if (singles % 2 === 1) {
      inlineOpen = !inlineOpen
    }
    out.push(trimmed.startsWith('|') ? fixTableRow(line) : line)
  }
  return out.join('\n')
}
