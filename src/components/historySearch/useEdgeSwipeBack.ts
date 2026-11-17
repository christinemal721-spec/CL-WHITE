import { useEffect, useRef, type RefObject } from 'react'
import { haptic } from '../../utils/haptic.js'

/**
 * 整页浮层（搜索、联系作者）共用：从左边缘右滑返回。
 * 页面跟手，松手过三分之一或快速一甩就滑出并关闭，否则弹回。
 */
export const useEdgeSwipeBack = (
  pageRef: RefObject<HTMLElement | null>,
  open: boolean,
  onDragStart: () => void,
  onClose: () => void
) => {
  // 回调每次渲染都是新的，存进 ref，不让手势监听反复重绑
  const callbacks = useRef({ onDragStart, onClose })
  callbacks.current = { onDragStart, onClose }

  useEffect(() => {
    const page = pageRef.current
    if (!page || !open) {
      return
    }
    const EDGE = 28
    let drag: { x: number; y: number; time: number; dx: number; horizontal: boolean | null } | null =
      null
    const reset = () => {
      page.style.transform = ''
      page.style.transition = ''
      page.style.boxShadow = ''
    }
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (event.touches.length !== 1 || touch.clientX > EDGE) {
        drag = null
        return
      }
      drag = { x: touch.clientX, y: touch.clientY, time: event.timeStamp, dx: 0, horizontal: null }
    }
    const onMove = (event: TouchEvent) => {
      if (!drag) {
        return
      }
      const touch = event.touches[0]
      const dx = touch.clientX - drag.x
      const dy = touch.clientY - drag.y
      if (drag.horizontal === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
          return
        }
        drag.horizontal = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.2
        if (!drag.horizontal) {
          drag = null
          return
        }
        callbacks.current.onDragStart()
        page.style.transition = 'none'
      }
      event.preventDefault()
      drag.dx = Math.max(0, dx)
      page.style.transform = `translateX(${drag.dx}px)`
      page.style.boxShadow = '-14px 0 36px rgba(0, 0, 0, 0.32)'
    }
    const onEnd = (event: TouchEvent) => {
      if (!drag?.horizontal) {
        drag = null
        return
      }
      const { dx, time } = drag
      drag = null
      const velocity = dx / Math.max(1, event.timeStamp - time)
      const width = page.getBoundingClientRect().width
      if (dx > width * 0.33 || (velocity > 0.45 && dx > 30)) {
        haptic()
        const remaining = Math.max(120, Math.min(260, ((width - dx) / width) * 300))
        page.style.transition = `transform ${remaining}ms cubic-bezier(0.3, 0.6, 0.4, 1), opacity ${remaining}ms ease`
        page.style.transform = `translateX(${width}px)`
        page.style.opacity = '0.7'
        window.setTimeout(() => {
          callbacks.current.onClose()
          requestAnimationFrame(() => {
            reset()
            page.style.opacity = ''
          })
        }, remaining)
      } else {
        page.style.transition = 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)'
        page.style.transform = 'translateX(0)'
        window.setTimeout(reset, 300)
      }
    }
    page.addEventListener('touchstart', onStart, { passive: true })
    page.addEventListener('touchmove', onMove, { passive: false })
    page.addEventListener('touchend', onEnd)
    page.addEventListener('touchcancel', onEnd)
    return () => {
      page.removeEventListener('touchstart', onStart)
      page.removeEventListener('touchmove', onMove)
      page.removeEventListener('touchend', onEnd)
      page.removeEventListener('touchcancel', onEnd)
    }
  }, [open, pageRef])
}
