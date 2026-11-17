import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

const DURATION = 300
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

/**
 * 高度平滑展开 / 收起，内容同时淡入淡出。
 * - 展开：0 → 实际高度，结束后改回 auto，之后内容继续增长（流式思考）也不受影响；
 * - 收起：当前高度 → 0，结束后才卸载内容；
 * - animate 为 false（首次渲染历史消息等）时直接切换，不播放动画。
 */
export const Collapse = ({
  open,
  animate = true,
  className,
  children,
}: {
  open: boolean
  animate?: boolean
  className?: string
  children: ReactNode
}) => {
  const ref = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(open)
  const first = useRef(true)

  if (open && !mounted) {
    setMounted(true)
  }

  useLayoutEffect(() => {
    const el = ref.current
    if (first.current) {
      first.current = false
      return
    }
    if (!el) {
      return
    }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!animate || reduced) {
      if (!open) {
        setMounted(false)
      }
      return
    }
    const from = open ? 0 : el.getBoundingClientRect().height
    const to = open ? el.scrollHeight : 0
    el.style.overflow = 'hidden'
    el.style.height = `${from}px`
    el.style.opacity = open ? '0' : '1'
    el.style.filter = open ? 'blur(4px)' : 'none'
    // 强制一次布局，让起点生效
    void el.offsetHeight
    el.style.transition = `height ${DURATION}ms ${EASE}, opacity ${open ? DURATION : 180}ms ${EASE}, filter ${DURATION}ms ${EASE}`
    el.style.height = `${to}px`
    el.style.opacity = open ? '1' : '0'
    el.style.filter = open ? 'none' : 'blur(3px)'
    const done = () => {
      el.style.transition = ''
      el.style.overflow = ''
      el.style.height = ''
      el.style.opacity = ''
      el.style.filter = ''
      if (!open) {
        setMounted(false)
      }
    }
    const timer = window.setTimeout(done, DURATION + 20)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!mounted) {
    return null
  }
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
