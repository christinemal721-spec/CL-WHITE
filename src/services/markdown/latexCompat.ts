/**
 * 把 KaTeX 不支持、但模型常用的 LaTeX 写法改成等价的 KaTeX 写法。
 * 典型场景是用 LaTeX 画的「卡片」：\colorbox 里套 tabular，行内用 \hfill 左右对齐。
 *
 * - 去掉零宽字符（BOM 等），KaTeX 遇到会报错
 * - tabular 换成 array；tabular 的格子是文字模式，所以每格包进 \text{}
 * - 格子里的 \hfill 拆成右对齐的新列，效果同「左边一段、右边一段」
 * - 整个表格包成 \text{$…$}，这样放在 \colorbox、\fbox 里也能用
 * - 修回被吃掉的 \t：指令文本经过某些工具复制后，\textcolor 里的 \t 会变成 Tab 字符，只剩「Tab + extcolor」
 * - 去掉模型输出时加的 Markdown 转义（\[人名\]、\>）：在 LaTeX 里 \[ 是「开始公式块」，放在卡片中间直接报错
 * - 其余 KaTeX 不认、只影响排版的命令（\centering、\vspace、多余的 \hfill）去掉或换成空白
 */

const ZERO_WIDTH = /\uFEFF|\u200B|\u200C|\u200D|\u2060/g

/** 读一段配对的花括号，返回内容和结束位置（不含右括号后的位置） */
const readGroup = (source: string, open: number): [string, number] | null => {
  if (source[open] !== '{') {
    return null
  }
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const char = source[i]
    if (char === '\\') {
      i++
      continue
    }
    if (char === '{') {
      depth++
    } else if (char === '}') {
      depth--
      if (depth === 0) {
        return [source.slice(open + 1, i), i + 1]
      }
    }
  }
  return null
}

/** 按顶层（不在花括号里）的分隔符切开 */
const splitTop = (source: string, separator: RegExp) => {
  const parts: string[] = []
  let depth = 0
  let last = 0
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (depth === 0) {
      separator.lastIndex = i
      const match = separator.exec(source)
      if (match && match.index === i && match[0]) {
        parts.push(source.slice(last, i))
        last = i + match[0].length
        i = last - 1
        continue
      }
    }
    if (char === '\\') {
      // 跳过转义的下一个字符（\{、\&），\\ 换行符也整体跳过
      i++
    } else if (char === '{') {
      depth++
    } else if (char === '}') {
      depth--
    }
  }
  parts.push(source.slice(last))
  return parts
}

/** 列格式：p{3cm} 之类换成 l，去掉 | 以外 KaTeX 不认的 @{…} */
const parseColumns = (spec: string) => {
  const columns: string[] = []
  const clean = spec.replace(/[@!>]\{[^{}]*\}/g, '').replace(/[pmbX]\{[^{}]*\}/g, 'l')
  for (const char of clean) {
    if ('lcr'.includes(char)) {
      columns.push(char)
    } else if (char === '|' && columns.length) {
      columns[columns.length - 1] += '|'
    } else if (char === '|') {
      columns.push('|')
    }
  }
  return columns
}

/** 去掉命令和花括号后剩下的可见文字 */
const visibleText = (cell: string) =>
  cell
    .replace(/\\(?:textcolor|color|colorbox)\s*\{[^{}]*\}/g, '')
    .replace(/\\[A-Za-z]+\*?/g, '')
    .replace(/[{}$]/g, '')
    .trim()

/** 粗略估算文字宽度（em）：中文和全角字符 1 个字宽，其它算半个多一点 */
const textWidth = (cell: string) =>
  [...visibleText(cell)].reduce((sum, char) => sum + (/[\u2e80-\uffef]/.test(char) ? 1 : 0.55), 0)

/** 只由横线字符组成的格子：模型拿来画分隔线 */
const isDivider = (cell: string) => /^[─━—―\-=_~·•.]{4,}$/.test(visibleText(cell).replace(/\s/g, ''))

/** KaTeX 表格两列之间的间距（em），和字宽的校准系数：按实际渲染量出来的 */
const COLUMN_GAP = 1
const WIDTH_SCALE = 1
/** 卡片行距：对照官端截图调的 */
const ROW_STRETCH = 1.4

const RULES = /^\s*((?:\\(?:hline|toprule|midrule|bottomrule|cline\{[^{}]*\})\s*)+)/

const convertTabular = (spec: string, body: string) => {
  const leading = spec.startsWith('|') ? '|' : ''
  const columns = parseColumns(spec.replace(/^\|/, '')).filter((column) => column !== '|')
  const rows = splitTop(body, /\\\\(?:\[[^\]]*\])?/y).map((row) => {
    const rule = row.match(RULES)?.[1] ?? ''
    const cells = splitTop(row.slice(rule.length), /(?<!\\)&/y).map((cell) => splitTop(cell, /\\hfill\b/y))
    return { rule: rule.replace(/\\(?:toprule|midrule|bottomrule)/g, '\\hline'), cells }
  })
  // 最后一行常常只剩换行符后面的空白或一条横线
  const last = rows.at(-1)
  if (last && last.cells.length === 1 && last.cells[0].length === 1 && !last.cells[0][0].trim()) {
    if (last.rule) {
      last.cells = []
    } else {
      rows.pop()
    }
  }
  const columnCount = Math.max(columns.length, ...rows.map((row) => row.cells.length))
  const dividerRow = (row: (typeof rows)[number]) =>
    row.cells.length === 1 && row.cells[0].length === 1 && isDivider(row.cells[0][0])
  // 每个原始列因为 \hfill 多出来几列
  const extra = Array.from({ length: columnCount }, (_, column) =>
    Math.max(0, ...rows.map((row) => (row.cells[column]?.length ?? 1) - 1))
  )
  // 分隔线跟着表格宽度走：每一列取最宽的格子，加起来再加列间距
  const pieceWidths: number[] = []
  for (const row of rows) {
    if (dividerRow(row)) {
      continue
    }
    let index = 0
    for (let column = 0; column < columnCount; column++) {
      const pieces = row.cells[column] ?? ['']
      for (let piece = 0; piece <= extra[column]; piece++) {
        // \hfill 拆出来的右半段前面有一个 \quad
        const width = textWidth(pieces[piece] ?? '') + (piece > 0 && pieces[piece] ? 1 : 0)
        pieceWidths[index] = Math.max(pieceWidths[index] ?? 0, width)
        index++
      }
    }
  }
  // 和官端一致：分隔线保留原来的 ━━━ 字符，表格宽度跟着它走
  const hasHfill = extra.some((count) => count > 0)
  if (hasHfill && columnCount === 1) {
    return hfillCard(columns[0] ?? 'l', rows, dividerRow)
  }
  // 多列表格里的 \hfill：右半段拆成单独一列，分隔线不占宽度（\rlap），
  // 再用 \kern 把第一列撑到「分隔线长度 − 右边几列」（按估算的字宽）
  const dividerWidth = Math.max(0, ...rows.filter(dividerRow).map((row) => textWidth(row.cells[0][0])))
  const restWidth =
    pieceWidths.slice(1).reduce((sum, width) => sum + width, 0) +
    Math.max(0, pieceWidths.length - 1) * COLUMN_GAP
  const firstColumn = Math.max(0, dividerWidth - restWidth)
  const newSpec =
    leading +
    Array.from({ length: columnCount }, (_, column) => {
      const base = columns[column] ?? 'l'
      const align = base.replace('|', '')
      return extra[column] ? align + 'r'.repeat(extra[column]) + base.slice(1) : base
    }).join('')
  const lines = rows.map((row) => {
    const { rule, cells } = row
    if (!cells.length) {
      return rule
    }
    if (hasHfill && dividerRow(row)) {
      const kern = firstColumn > 0 ? `\\kern{${(firstColumn * WIDTH_SCALE).toFixed(2)}em}` : ''
      return `${rule}\\rlap{\\text{${cells[0][0].trim()}}}${kern}`
    }
    const parts: string[] = []
    for (let column = 0; column < columnCount; column++) {
      const pieces = cells[column] ?? ['']
      for (let piece = 0; piece <= extra[column]; piece++) {
        const content = (pieces[piece] ?? '').trim()
        // \hfill 拆出来的右半段前面留一点空隙
        parts.push(content ? `\\text{${piece > 0 ? '\\quad ' : ''}${content}}` : '')
      }
    }
    return `${rule}${parts.join(' & ')}`
  })
  // 行距和官端（tabular 默认）一样松一些，第一行上方也就不会贴着卡片边缘
  return `\\text{$\\def\\arraystretch{${ROW_STRETCH}}\\begin{array}{${newSpec}}${lines.join(' \\\\ ')}\\end{array}$}`
}

type CardRow = { rule: string; cells: string[][] }

/**
 * 单列卡片里的「左边名字 \hfill 右边状态」：
 * 所有行做成同样宽的盒子（取分隔线和最宽几行里最宽的那个），左段贴左、右段贴右，右栏整齐落在卡片右边；
 * 分隔线左右各放一份，盖满整个宽度，不会比内容短。
 * 宽度用 \phantom 按真实字形量，不靠估算，手机换了字体也对得齐
 */
const hfillCard = (spec: string, rows: CardRow[], dividerRow: (row: CardRow) => boolean) => {
  const split = rows.map(({ cells }) => {
    const pieces = (cells[0] ?? []).map((piece) => piece.trim())
    if (pieces.length < 2) {
      return null
    }
    return { left: pieces.slice(0, -1).filter(Boolean).join('\\quad '), right: pieces.at(-1) ?? '' }
  })
  // 量宽度的候选：所有分隔线 + 估算最宽的几行（行很多时不必每行都量）
  const dividers = [...new Set(rows.filter(dividerRow).map((row) => row.cells[0][0].trim()))]
  const others = rows
    .map((row, index) => {
      if (!row.cells.length || dividerRow(row)) {
        return ''
      }
      const pair = split[index]
      return pair ? `${pair.left}\\quad ${pair.right}` : (row.cells[0]?.[0] ?? '').trim()
    })
    .filter(Boolean)
  const widest = [...new Set(others)]
    .map((text) => ({ text, width: textWidth(text) }))
    .sort((a, b) => b.width - a.width)
    .slice(0, 4)
    .map(({ text }) => text)
  const box = `\\smash{\\begin{matrix}${[...dividers, ...widest]
    .map((text) => `\\phantom{\\text{${text}}}`)
    .join(' \\\\ ')}\\end{matrix}}`
  const lines = rows.map((row, index) => {
    const { rule, cells } = row
    if (!cells.length) {
      return rule
    }
    if (dividerRow(row)) {
      const line = `\\text{${cells[0][0].trim()}}`
      return `${rule}\\rlap{${line}}${box}\\llap{${line}}`
    }
    const pair = split[index]
    if (!pair) {
      const text = (cells[0]?.[0] ?? '').trim()
      return `${rule}${text ? `\\text{${text}}` : ''}`
    }
    return `${rule}\\rlap{\\text{${pair.left}}}${box}\\llap{\\text{${pair.right}}}`
  })
  return `\\text{$\\def\\arraystretch{${ROW_STRETCH}}\\begin{array}{${spec}}${lines.join(' \\\\ ')}\\end{array}$}`
}

const BEGIN_TABULAR = /\\begin\{tabular\*?\}/g

/** 模型给标点加的 Markdown 转义；在卡片里一律还原成标点本身 */
const MARKDOWN_ESCAPED = new Set(['[', ']', '(', ')', '<', '>', '*', '-', '!', '`', '|'])

const isCard = (source: string) =>
  /\\(?:colorbox|fcolorbox|fbox|textcolor)\b|\\begin\{tabular/.test(source)

/** 逐字扫描：\\ 换行符原样保留，\[ \> 这类转义还原成 [ > */
const unescapeMarkdown = (source: string) => {
  let result = ''
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (char !== '\\') {
      result += char
      continue
    }
    const next = source[i + 1]
    if (next === '\\') {
      result += '\\\\'
      i++
    } else if (next !== undefined && MARKDOWN_ESCAPED.has(next)) {
      result += next
      i++
    } else {
      result += char
    }
  }
  return result
}

/** 「Tab + extcolor」这类：\t 开头的命令被当成制表符吃掉，修回去 */
const EATEN_TAB =
  /\t(ext(?:color|bf|it|rm|sf|tt|normal|up)?|imes|frac|heta|au|ilde|an|ag|op|riangle|herefore|extstyle)(?![A-Za-z])/g

/** 卡片转网页排版前的清理：去零宽字符、修回 \t、还原 Markdown 转义（和 fixLatex 开头一样） */
export const cleanCardSource = (input: string): string =>
  unescapeMarkdown(input.replace(ZERO_WIDTH, '').replace(EATEN_TAB, '\\t$1'))

export const fixLatex = (input: string): string => {
  let source = input.replace(ZERO_WIDTH, '').replace(EATEN_TAB, '\\t$1')
  if (isCard(source)) {
    // 中间点 · 在 KaTeX 的文字模式里会报错，换成外观相同的「・」
    source = unescapeMarkdown(source).replace(/\u00B7/g, '\u30FB')
  }
  if (source.includes('\\begin{tabular')) {
    let result = ''
    let last = 0
    for (const match of source.matchAll(BEGIN_TABULAR)) {
      if (match.index < last) {
        continue
      }
      let cursor = match.index + match[0].length
      // tabular* 的宽度参数
      if (match[0].includes('*')) {
        const width = readGroup(source, cursor)
        cursor = width ? width[1] : cursor
      }
      // 可选的位置参数 [t]
      const position = source.slice(cursor).match(/^\s*\[[^\]]*\]/)
      cursor += position ? position[0].length : 0
      while (source[cursor] === ' ' || source[cursor] === '\n') {
        cursor++
      }
      const spec = readGroup(source, cursor)
      if (!spec) {
        continue
      }
      const end = source.indexOf('\\end{tabular', spec[1])
      if (end === -1) {
        continue
      }
      const closing = source.indexOf('}', end) + 1
      result += source.slice(last, match.index) + convertTabular(spec[0], source.slice(spec[1], end))
      last = closing
    }
    source = result + source.slice(last)
  }
  return source
    .replace(/\\(?:centering|raggedright|raggedleft|noindent)\b/g, '')
    .replace(/\\vspace\*?\{[^{}]*\}/g, '')
    .replace(/\\hfill\b/g, '\\quad ')
}
