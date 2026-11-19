/**
 * 纯文字的 LaTeX「卡片」改用网页排版：KaTeX 的排版不能换行，长句子在手机上只能缩到很小或溢出右侧。
 * 这里把 \colorbox / tabular / array 里的文字、颜色、加粗按原样转成 HTML，文字可以自动换行。
 *
 * 只接手「纯文字」：出现上下标、分式等真正的数学内容，或认不出的命令，就返回 null，仍交给 KaTeX。
 * 文字里夹的 $…$ 小公式用传进来的 renderMath 单独渲染。
 */

type RenderMath = (latex: string) => string

class NotText extends Error {}

const fail = (): never => {
  throw new NotText()
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const NAMED_COLOR = /^[a-zA-Z]{3,20}$/
const HEX = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** LaTeX 颜色名 → CSS；只放行颜色名和十六进制，防止注入样式 */
const cssColor = (raw: string, model = '') => {
  const value = raw.trim()
  if (/^html$/i.test(model) || HEX.test(value)) {
    const hex = value.replace(/^#/, '')
    return HEX.test(hex) ? `#${hex}` : fail()
  }
  if (model) {
    fail()
  }
  return NAMED_COLOR.test(value) ? value.toLowerCase() : fail()
}

/** 直接换成字符的命令 */
const SYMBOLS: Record<string, string> = {
  quad: ' ',
  qquad: '  ',
  enspace: ' ',
  cdot: '·',
  cdots: '⋯',
  ldots: '…',
  dots: '…',
  times: '×',
  div: '÷',
  pm: '±',
  to: '→',
  rightarrow: '→',
  leftarrow: '←',
  Rightarrow: '⇒',
  Leftarrow: '⇐',
  leftrightarrow: '↔',
  uparrow: '↑',
  downarrow: '↓',
  longrightarrow: '⟶',
  mapsto: '↦',
  bullet: '•',
  circ: '∘',
  star: '★',
  bigstar: '★',
  checkmark: '✓',
  heartsuit: '♥',
  spadesuit: '♠',
  clubsuit: '♣',
  diamondsuit: '♦',
  triangleright: '▷',
  blacktriangleright: '▶',
  blacktriangleleft: '◀',
  square: '□',
  blacksquare: '■',
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  ne: '≠',
  neq: '≠',
  approx: '≈',
  sim: '∼',
  infty: '∞',
  mid: '|',
  vert: '|',
  textbar: '|',
  textgreater: '>',
  textless: '<',
  lbrack: '[',
  rbrack: ']',
  langle: '⟨',
  rangle: '⟩',
  textasciitilde: '~',
  textbackslash: '\\',
  textbullet: '•',
  textperiodcentered: '·',
  S: '§',
  copyright: '©',
  degree: '°',
}

/** 只是改字号、排版，在网页里直接忽略 */
const IGNORED = new Set([
  'tiny',
  'scriptsize',
  'footnotesize',
  'small',
  'normalsize',
  'large',
  'Large',
  'LARGE',
  'huge',
  'Huge',
  'displaystyle',
  'textstyle',
  'centering',
  'raggedright',
  'raggedleft',
  'noindent',
  'hline',
  'toprule',
  'midrule',
  'bottomrule',
  'strut',
  'relax',
  'normalfont',
  'rmfamily',
  'sffamily',
  'mdseries',
  'upshape',
  'left',
  'right',
])

/** 带一个参数、参数原样当文字 */
const PLAIN = new Set([
  'text',
  'textrm',
  'textsf',
  'textnormal',
  'textup',
  'textmd',
  'mathrm',
  'mathsf',
  'mbox',
  'hbox',
  'operatorname',
])
const WRAP: Record<string, [string, string]> = {
  textbf: ['<strong>', '</strong>'],
  mathbf: ['<strong>', '</strong>'],
  boldsymbol: ['<strong>', '</strong>'],
  bm: ['<strong>', '</strong>'],
  textit: ['<em>', '</em>'],
  emph: ['<em>', '</em>'],
  textsl: ['<em>', '</em>'],
  mathit: ['<em>', '</em>'],
  texttt: ['<code>', '</code>'],
  mathtt: ['<code>', '</code>'],
  underline: ['<u>', '</u>'],
  uline: ['<u>', '</u>'],
  textsc: ['<span style="font-variant:small-caps">', '</span>'],
}
/** 对当前花括号里剩下的内容生效的开关命令 */
const SWITCH: Record<string, [string, string]> = {
  bfseries: ['<strong>', '</strong>'],
  bf: ['<strong>', '</strong>'],
  itshape: ['<em>', '</em>'],
  it: ['<em>', '</em>'],
  ttfamily: ['<code>', '</code>'],
}
/** 吃掉参数、不出任何内容 */
const SWALLOW: Record<string, number> = { vspace: 1, hspace: 1, rule: 2, phantom: 1, label: 1, kern: 0 }

const readGroup = (source: string, open: number): [string, number] => {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const char = source[i]
    if (char === '\\') {
      i++
    } else if (char === '{') {
      depth++
    } else if (char === '}') {
      depth--
      if (depth === 0) {
        return [source.slice(open + 1, i), i + 1]
      }
    }
  }
  return fail()
}

/** 读一个参数：{…}，或者单个字符 / 命令 */
const readArg = (source: string, start: number): [string, number] => {
  let i = start
  while (source[i] === ' ' || source[i] === '\n') {
    i++
  }
  if (source[i] === '{') {
    return readGroup(source, i)
  }
  if (i >= source.length) {
    fail()
  }
  if (source[i] === '\\') {
    const name = /^\\(?:[A-Za-z]+|.)/.exec(source.slice(i))?.[0] ?? fail()
    return [name, i + name.length]
  }
  return [source[i], i + 1]
}

const readOptional = (source: string, start: number): [string, number] => {
  let i = start
  while (source[i] === ' ') {
    i++
  }
  if (source[i] !== '[') {
    return ['', start]
  }
  const end = source.indexOf(']', i)
  return end === -1 ? fail() : [source.slice(i + 1, end), end + 1]
}

/** 数学模式里出现就说明不是纯文字 */
const MATH_ONLY = /[\^_]/

const convert = (source: string, renderMath: RenderMath, text: boolean): string => {
  let out = ''
  let i = 0
  while (i < source.length) {
    const char = source[i]
    if (char === '\\') {
      const match = /^\\([A-Za-z]+\*?|.)/.exec(source.slice(i)) ?? fail()
      const name = match[1].replace(/\*$/, '')
      i += match[0].length
      if (name.length === 1 && !/[A-Za-z]/.test(name)) {
        // \% \& \# \$ \_ \{ \} 和各种间距
        if ('%&#$_{}|<>[]'.includes(name)) {
          out += escapeHtml(name)
        } else if (',;: '.includes(name)) {
          out += ' '
        } else if (name !== '!' && name !== '/') {
          fail()
        }
        continue
      }
      if (name in SYMBOLS) {
        out += SYMBOLS[name]
      } else if (IGNORED.has(name)) {
        // 什么都不输出
      } else if (PLAIN.has(name)) {
        const [arg, next] = readArg(source, i)
        out += convert(arg, renderMath, true)
        i = next
      } else if (name in WRAP) {
        const [arg, next] = readArg(source, i)
        const [open, close] = WRAP[name]
        out += open + convert(arg, renderMath, text) + close
        i = next
      } else if (name in SWITCH) {
        const [open, close] = SWITCH[name]
        out += open + convert(source.slice(i), renderMath, text) + close
        return out
      } else if (name === 'textcolor') {
        const [model, afterModel] = readOptional(source, i)
        const [color, afterColor] = readArg(source, afterModel)
        const [arg, next] = readArg(source, afterColor)
        out += `<span style="color:${cssColor(color, model)}">${convert(arg, renderMath, text)}</span>`
        i = next
      } else if (name === 'color') {
        const [model, afterModel] = readOptional(source, i)
        const [color, next] = readArg(source, afterModel)
        out += `<span style="color:${cssColor(color, model)}">${convert(source.slice(next), renderMath, text)}</span>`
        return out
      } else if (name === 'colorbox' || name === 'fcolorbox') {
        const [model, afterModel] = readOptional(source, i)
        let cursor = afterModel
        let border = ''
        if (name === 'fcolorbox') {
          const [frame, afterFrame] = readArg(source, cursor)
          border = `;box-shadow:inset 0 0 0 1px ${cssColor(frame, model)}`
          cursor = afterFrame
        }
        const [color, afterColor] = readArg(source, cursor)
        const [arg, next] = readArg(source, afterColor)
        out += `<span class="ds-tex-mark" style="background:${cssColor(color, model)}${border}">${convert(arg, renderMath, true)}</span>`
        i = next
      } else if (name === 'fbox' || name === 'boxed' || name === 'framebox') {
        const [arg, next] = readArg(source, i)
        out += `<span class="ds-tex-mark is-framed">${convert(arg, renderMath, true)}</span>`
        i = next
      } else if (name === 'hfill' || name === 'hfil') {
        out += ' '
      } else if (name in SWALLOW) {
        if (name === 'kern') {
          // \kern1em / \kern{1em}
          const rest = /^\s*(?:\{[^{}]*\}|-?[\d.]+\s*[a-z]{2})/.exec(source.slice(i))
          i += rest ? rest[0].length : 0
        } else {
          for (let n = 0; n < SWALLOW[name]; n++) {
            i = readArg(source, readOptional(source, i)[1])[1]
          }
        }
        out += name === 'hspace' ? ' ' : ''
      } else {
        fail()
      }
      continue
    }
    if (char === '{') {
      const [inner, next] = readGroup(source, i)
      out += convert(inner, renderMath, text)
      i = next
      continue
    }
    if (char === '}') {
      fail()
    }
    if (char === '$') {
      // 文字里的小公式：$…$
      if (!text) {
        fail()
      }
      const end = source.indexOf('$', i + 1)
      if (end === -1) {
        fail()
      }
      const math = source.slice(i + 1, end)
      out += math.trim() ? renderMath(math) : ''
      i = end + 1
      continue
    }
    if (char === '~') {
      out += ' '
      i++
      continue
    }
    if (!text && MATH_ONLY.test(char)) {
      fail()
    }
    out += escapeHtml(char)
    i++
  }
  return out
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

/** 去掉命令后只剩横线字符：模型拿来画分隔线 */
const isDivider = (cell: string) => {
  const visible = cell
    .replace(/\\(?:textcolor|color)\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}/g, '')
    .replace(/\\[A-Za-z]+\*?/g, '')
    .replace(/[{}$\s]/g, '')
  return /^[─━—―\-=_~·•.]{4,}$/.test(visible)
}

/** 分隔线的颜色跟着原来写的颜色走 */
const dividerColor = (cell: string) => {
  const match = /\\(?:textcolor|color)\s*(\[[^\]]*\])?\s*\{([^{}]*)\}/.exec(cell)
  if (!match) {
    return ''
  }
  try {
    return cssColor(match[2], match[1]?.slice(1, -1) ?? '')
  } catch {
    return ''
  }
}

const ENVIRONMENT =
  /^\\begin\{(tabular\*?|array|matrix|smallmatrix|aligned|gathered|align\*?|gather\*?)\}/

type Frame = { background?: string; border?: string }

/** 剥掉外面一层层的 \colorbox{…}{…}、\fbox{…}、\text{$…$}、$…$、{…} */
const unwrap = (input: string, frame: Frame): string => {
  let source = input.trim()
  for (let guard = 0; guard < 8; guard++) {
    let match: RegExpExecArray | null
    if ((match = /^\\(f?colorbox)\s*(?:\[([^\]]*)\])?\s*/.exec(source))) {
      let cursor = match[0].length
      if (match[1] === 'fcolorbox') {
        const [border, next] = readArg(source, cursor)
        frame.border = cssColor(border, match[2] ?? '')
        cursor = next
      }
      const [color, afterColor] = readArg(source, cursor)
      const [inner, end] = readArg(source, afterColor)
      if (source.slice(end).trim()) {
        return source
      }
      frame.background = cssColor(color, match[2] ?? '')
      source = inner.trim()
    } else if ((match = /^\\(?:fbox|boxed|text|mbox|hbox)\s*(?=\{)/.exec(source))) {
      const [inner, end] = readGroup(source, match[0].length)
      if (source.slice(end).trim()) {
        return source
      }
      if (!match[0].startsWith('\\text') && !match[0].startsWith('\\mbox') && !match[0].startsWith('\\hbox')) {
        frame.border ??= 'currentColor'
      }
      source = inner.trim()
    } else if (source.startsWith('$') && source.endsWith('$') && source.length > 1) {
      source = source.replace(/^\$+|\$+$/g, '').trim()
    } else if (source.startsWith('{')) {
      const [inner, end] = readGroup(source, 0)
      if (source.slice(end).trim()) {
        return source
      }
      source = inner.trim()
    } else if (/^\\begin\{center\}[\s\S]*\\end\{center\}$/.test(source)) {
      source = source.replace(/^\\begin\{center\}|\\end\{center\}$/g, '').trim()
    } else {
      return source
    }
  }
  return source
}

const RULE = /^\s*((?:\\(?:hline|toprule|midrule|bottomrule|cline\{[^{}]*\})\s*)+)/

/**
 * 把一块显示公式试着转成网页卡片。不是纯文字卡片（或认不出来）返回 null。
 * 输入应已去掉零宽字符、还原过 Markdown 转义。
 */
export const textCardHtml = (input: string, renderMath: RenderMath): string | null => {
  try {
    const frame: Frame = {}
    let source = unwrap(input, frame)
    let columns: string[] = []
    let separatorCells = true
    const env = ENVIRONMENT.exec(source)
    if (env) {
      const name = env[1]
      const end = source.lastIndexOf(`\\end{${name}}`)
      if (end === -1 || source.slice(end + `\\end{${name}}`.length).trim()) {
        return null
      }
      let cursor = env[0].length
      if (name.startsWith('tabular') || name === 'array') {
        if (name === 'tabular*') {
          cursor = readArg(source, cursor)[1]
        }
        cursor = readOptional(source, cursor)[1]
        const [spec, next] = readArg(source, cursor)
        columns = [...spec.replace(/[@!>]\{[^{}]*\}/g, '').replace(/[pmbX]\{[^{}]*\}/g, 'l')].filter((c) =>
          'lcr'.includes(c)
        )
        cursor = next
      } else if (/^(?:aligned|align|gathered|gather)/.test(name)) {
        // 对齐符 & 只是对齐用，合成一格
        separatorCells = false
      }
      source = source.slice(cursor, end)
    } else if (!/\\\\/.test(source)) {
      // 不是表格也没有换行：普通公式，不接手
      return null
    }
    const rows = splitTop(source, /\\\\(?:\[[^\]]*\])?/y)
    if (rows.length && !rows.at(-1)?.trim()) {
      rows.pop()
    }
    // 至少要有文字：全是符号、数字的多半是矩阵
    if (!/\\text|[⺀-￯]/.test(source)) {
      return null
    }
    const parsed = rows.map((row) => {
      const rule = RULE.exec(row)?.[1] ?? ''
      const body = row.slice(rule.length)
      const cells = separatorCells ? splitTop(body, /(?<!\\)&/y) : [body.replace(/(?<!\\)&/g, '')]
      return { rule: Boolean(rule), cells }
    })
    const count = Math.max(1, columns.length, ...parsed.map((row) => row.cells.length))
    const lines = parsed.map(({ rule, cells }) => {
      const ruleClass = rule ? ' is-ruled' : ''
      if (cells.length === 1 && isDivider(cells[0])) {
        const color = dividerColor(cells[0])
        return `<tr class="ds-tex-divider${ruleClass}"><td colspan="${count}"><hr${color ? ` style="border-color:${color}"` : ''}></td></tr>`
      }
      if (cells.length === 1 && !cells[0].trim()) {
        // 空行：模型拿来分段，留一点间距
        return `<tr class="ds-tex-empty${ruleClass}"><td colspan="${count}"></td></tr>`
      }
      const tds = cells.map((cell, index) => {
        const align = columns[index] === 'c' ? 'center' : columns[index] === 'r' ? 'right' : 'left'
        const span = index === cells.length - 1 && cells.length < count ? ` colspan="${count - index}"` : ''
        const pieces = splitTop(cell, /\\hfill\b/y).map((piece) => piece.trim())
        const html =
          pieces.length > 1
            ? `<span class="ds-tex-split">${pieces
                .map((piece) => `<span>${convert(piece, renderMath, false)}</span>`)
                .join('')}</span>`
            : convert(pieces[0], renderMath, false).trim()
        return `<td${span} style="text-align:${align}">${html}</td>`
      })
      return `<tr class="${ruleClass.trim()}">${tds.join('')}</tr>`
    })
    const style = [
      frame.background ? `background:${frame.background}` : '',
      frame.border ? `box-shadow:inset 0 0 0 1px ${frame.border}` : '',
    ]
      .filter(Boolean)
      .join(';')
    const framed = frame.background || frame.border ? ' is-framed' : ''
    return `<div class="ds-tex-card${framed}"${style ? ` style="${style}"` : ''}><table><tbody>${lines.join('')}</tbody></table></div>`
  } catch (error) {
    if (error instanceof NotText) {
      return null
    }
    throw error
  }
}
