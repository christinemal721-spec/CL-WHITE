import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ensureKatex, type Katex } from '../../services/markdown/katex.js'
import { cleanCardSource, fixLatex } from '../../services/markdown/latexCompat.js'
import { textCardHtml } from '../../services/markdown/textCard.js'
import { reloadForStaleChunk } from '../../services/pwa.js'

/** renderToString 外层包裹的标签，组件自己渲染外层，这里切掉 */
const KATEX_WRAPPER = {
  inline: ['<span class="katex">', '</span>'],
  display: ['<span class="katex-display"><span class="katex">', '</span></span>'],
} as const

type MathHtmlResult = {
  html: string
  renderMode: 'katex' | 'fallback'
  katex?: Katex | null
}

const LOAD_RETRIES = 3

/** 模型常用、但 KaTeX 没有内置的几个命令 */
const MACROS = {
  '\\abs': '\\left\\lvert #1 \\right\\rvert',
  '\\norm': '\\left\\lVert #1 \\right\\rVert',
  '\\dd': '\\mathrm{d}',
  '\\argmax': '\\operatorname*{arg\\,max}',
  '\\argmin': '\\operatorname*{arg\\,min}',
  '\\sgn': '\\operatorname{sgn}',
}

const render = (katex: Katex, input: string, displayMode: boolean) =>
  katex.renderToString(fixLatex(input), {
    throwOnError: true,
    strict: false,
    displayMode,
    macros: { ...MACROS },
  })

/** KaTeX 渲染公式；出错时保留上次成功的结果（流式中公式未写完），没有则展示原文 */
const useMathHtml = (input: string, isInline: boolean): MathHtmlResult & { katex: Katex | null } => {
  const previousResultRef = useRef<MathHtmlResult | null>(null)
  // 只在首次渲染时取一次：useRef(ensureKatex()) 会在每次渲染都调用，
  // 加载失败后每次都生成一个没人接的失败，触发全局兜底刷新
  const katexRef = useRef<Katex | Promise<Katex> | null>(null)
  katexRef.current ??= ensureKatex()
  const [katex, setKatex] = useState<Katex | null>(
    katexRef.current instanceof Promise ? null : katexRef.current
  )

  // 公式引擎加载失败（网络抖动、被浏览器拦截、网站刚更新）：隔一会儿重试，
  // 几次都不行而且是网站更新导致的，就刷新到新版；不再一直按源码显示
  useEffect(() => {
    if (!(katexRef.current instanceof Promise)) {
      return
    }
    let cancelled = false
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const wait = (loading: Katex | Promise<Katex>) => {
      if (!(loading instanceof Promise)) {
        setKatex(loading)
        return
      }
      loading.then(
        (loaded) => !cancelled && setKatex(loaded),
        (error: unknown) => {
          if (cancelled) {
            return
          }
          attempt++
          if (attempt <= LOAD_RETRIES) {
            timer = setTimeout(() => wait(ensureKatex()), 1500 * attempt)
          } else {
            reloadForStaleChunk(error)
          }
        }
      )
    }
    wait(katexRef.current)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  const result = useMemo((): MathHtmlResult => {
    if (!katex) {
      return { html: input, renderMode: 'fallback' }
    }
    try {
      const [prefix, suffix] = KATEX_WRAPPER[isInline ? 'inline' : 'display']
      const html = render(katex, input, !isInline).slice(prefix.length, -suffix.length)
      const result = { html, renderMode: 'katex' } as const
      previousResultRef.current = result
      return result
    } catch {
      return previousResultRef.current ?? { html: input, renderMode: 'fallback' }
    }
  }, [input, isInline, katex])
  return { ...result, katex }
}

/** 纯文字卡片：KaTeX 版要缩到这个比例以下才放得下，就改用能换行的网页排版 */
const WRAP_BELOW = 0.75

export const MathBlock = memo(function MathBlock({ value }: { value: string }) {
  const { html, renderMode, katex } = useMathHtml(value, false)
  // 能换行的网页版：只在 KaTeX 版放不下时才用，放得下的卡片保持和官端一样的排版
  const cardRef = useRef<string | null>(null)
  const card = useMemo(() => {
    if (!katex || !TEXTISH.test(value)) {
      return null
    }
    const result = textCardHtml(cleanCardSource(value), (math) =>
      katex.renderToString(fixLatex(math), { throwOnError: false, strict: false, macros: { ...MACROS } })
    )
    // 流式输出中卡片还没写完时沿用上一次的结果
    if (result) {
      cardRef.current = result
    }
    return result ?? cardRef.current
  }, [value, katex])
  const [wrap, setWrap] = useState(false)
  const onTooWide = useCallback(() => setWrap(true), [])
  const fitRef = useFitWidth(
    value,
    renderMode === 'katex' && !(wrap && card) ? html : '',
    card ? onTooWide : undefined
  )
  if (wrap && card) {
    return <div className="ds-markdown-math ds-tex-wrap" dangerouslySetInnerHTML={{ __html: card }}></div>
  }
  if (renderMode === 'fallback') {
    // 渲染不了的公式按源码显示，至少看得清
    return (
      <pre className="ds-markdown-math-raw">
        <code>{html}</code>
      </pre>
    )
  }
  return (
    <span ref={fitRef} className="katex-display ds-markdown-math">
      <span className="katex" dangerouslySetInnerHTML={{ __html: html }}></span>
    </span>
  )
})

/** 可能是文字卡片：有 \text 类命令、表格环境或中文 */
const TEXTISH = /\\(?:text|colorbox|fcolorbox|fbox|begin\{(?:tabular|array))|[\u2e80-\uffef]/

/** 卡片（\colorbox、tabular）最多缩到这么小；普通长公式缩太小难读，下限高一些 */
const MIN_SCALE_CARD = 0.45
const MIN_SCALE_FORMULA = 0.7
const CARD = /\\(?:colorbox|fcolorbox|fbox|textcolor)\b|\\begin\{tabular/

/**
 * 公式块比可用宽度宽时，按比例缩小字号，让整块刚好放下（公式的尺寸都跟字号走，等比缩放不变形）；
 * 缩到下限还放不下，就保留左右滑动。窗口宽度、字体变化时重新计算。
 */
const useFitWidth = (value: string, html: string, onTooWide?: () => void) => {
  const ref = useRef<HTMLSpanElement>(null)
  const min = CARD.test(value) ? MIN_SCALE_CARD : MIN_SCALE_FORMULA
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) {
      return
    }
    let width = -1
    const fit = () => {
      if (box.clientWidth === width) {
        return
      }
      width = box.clientWidth
      box.style.fontSize = ''
      if (onTooWide && box.scrollWidth > 0 && box.clientWidth / box.scrollWidth < WRAP_BELOW) {
        onTooWide()
        return
      }
      // 有些尺寸不完全跟字号等比变化，缩一次后再量，最多微调三次
      let scale = 1
      for (let i = 0; i < 3 && box.scrollWidth - box.clientWidth > 1 && scale > min; i++) {
        scale = Math.max(min, scale * (box.clientWidth / box.scrollWidth) * 0.98)
        box.style.fontSize = `${(scale * 100).toFixed(1)}%`
      }
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(box)
    // 公式字体是后加载的，到位后公式会变宽，重新算一次
    const refit = () => {
      width = -1
      fit()
    }
    void document.fonts?.ready.then(refit)
    document.fonts?.addEventListener('loadingdone', refit)
    return () => {
      observer.disconnect()
      document.fonts?.removeEventListener('loadingdone', refit)
    }
  }, [html, min, onTooWide])
  return ref
}

export const InlineMath = memo(function InlineMath({ value }: { value: string }) {
  const { html, renderMode } = useMathHtml(value, true)
  if (renderMode === 'fallback') {
    return <code className="ds-markdown-math-raw">{html}</code>
  }
  return <span className="katex" dangerouslySetInnerHTML={{ __html: html }}></span>
})
