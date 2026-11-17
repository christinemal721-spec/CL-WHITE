import { useLayoutEffect, type RefObject } from 'react'

/**
 * 容器高度由内部内容撑开（auto）。内容变高 / 变矮时，用 Web Animations 让容器平滑过渡，
 * 结束后回到 auto。ResizeObserver 在绘制前回调，所以不会先闪一下新高度；
 * 动画中途内容又变了，就从当前高度接着过渡到新高度。
 */
export const useSmoothHeight = (
  containerRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  duration = 180
) => {
  useLayoutEffect(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content || typeof ResizeObserver === 'undefined') {
      return
    }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let last = content.getBoundingClientRect().height
    let running: Animation | null = null
    const observer = new ResizeObserver(() => {
      const next = content.getBoundingClientRect().height
      if (Math.abs(next - last) < 1) {
        return
      }
      const from = running ? container.getBoundingClientRect().height : last
      running?.cancel()
      last = next
      if (reduced) {
        return
      }
      const animation = container.animate([{ height: `${from}px` }, { height: `${next}px` }], {
        duration,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      })
      running = animation
      animation.onfinish = () => {
        if (running === animation) {
          running = null
        }
      }
    })
    observer.observe(content)
    return () => {
      observer.disconnect()
      running?.cancel()
    }
  }, [containerRef, contentRef, duration])
}
