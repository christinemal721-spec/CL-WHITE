import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'

/** 窄于 768px 按移动端布局 */
const query = window.matchMedia('not all and (min-width: 768px)')

const subscribe = (onChange: () => void) => {
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

export const useIsMobile = () => useSyncExternalStore(subscribe, () => query.matches)

const isScrollable = (element: Element) => {
  if (element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth) {
    return false
  }
  const style = getComputedStyle(element)
  return /auto|scroll/.test(style.overflowY) || /auto|scroll/.test(style.overflowX)
}

/**
 * 移动端防整页回弹：只挂在不滚动的区域（顶栏、输入区、欢迎页）上。
 *
 * 以前是在 document 上挂非 passive 的 touchmove，iOS 因此每帧滚动都要等主线程
 * 跑完 JS 才能动，消息列表一忙就掉帧。现在消息列表不在任何非 passive 监听的
 * 区域内，滚动完全交给合成线程；整页本身由 CSS（overflow hidden +
 * overscroll-behavior none）锁住。
 */
export const useNoPageBounce = <T extends HTMLElement>(enabled: boolean) => {
  const ref = useRef<T>(null)
  useEffect(() => {
    const root = ref.current
    if (!enabled || !root) {
      return
    }
    const onMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        return
      }
      // 只在本区域内往上找：输入框内容超出时仍可滚动。
      for (
        let element = event.target instanceof Element ? event.target : null;
        element && element !== root.parentElement;
        element = element.parentElement
      ) {
        if (isScrollable(element)) {
          return
        }
      }
      event.preventDefault()
    }
    root.addEventListener('touchmove', onMove, { passive: false })
    return () => root.removeEventListener('touchmove', onMove)
  }, [enabled])
  return ref
}

/** 移动端页面跟随视觉视口，键盘弹出后顶栏和输入框仍留在可见区域。 */
export const useMobileViewport = (enabled: boolean) => {
  const frameRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!enabled || !frame) {
      return
    }
    const viewport = window.visualViewport
    const inputSelector = 'textarea, input:not([type="file"])'
    let animationFrame = 0
    // 记住上次写入的值：视口没变就不写样式，避免滚动时反复触发整页布局。
    let lastHeight = ''
    let lastTop = ''
    const reset = () => {
      if (!lastHeight && !lastTop) {
        return
      }
      lastHeight = ''
      lastTop = ''
      frame.style.removeProperty('--app-viewport-height')
      frame.style.removeProperty('--app-viewport-top')
    }
    const update = () => {
      // 双指缩放由浏览器处理，保持当前布局尺寸。
      if (viewport && viewport.scale !== 1) {
        return
      }
      // 失焦后直接恢复 CSS 的全高布局，不等 Safari 收键盘后的 resize。
      if (!document.activeElement?.matches(inputSelector)) {
        reset()
        return
      }
      const height = `${viewport?.height ?? window.innerHeight}px`
      const top = `${viewport?.offsetTop ?? 0}px`
      if (height !== lastHeight) {
        lastHeight = height
        frame.style.setProperty('--app-viewport-height', height)
      }
      if (top !== lastTop) {
        lastTop = top
        frame.style.setProperty('--app-viewport-top', top)
      }
    }
    const scheduleFrame = () => {
      cancelAnimationFrame(animationFrame)
      animationFrame = requestAnimationFrame(update)
    }
    const schedule = () => {
      // 先同步跟上键盘动画，下一帧再校准 Safari 延迟更新的视口读数。
      update()
      scheduleFrame()
    }
    const onFocusIn = () => {
      if (document.activeElement?.matches(inputSelector)) {
        schedule()
      }
    }

    update()
    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    document.addEventListener('focusin', onFocusIn)
    // 等点击和焦点切换完成，避免按钮移动、或切换输入框时短暂恢复全高。
    document.addEventListener('focusout', scheduleFrame)
    return () => {
      cancelAnimationFrame(animationFrame)
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', scheduleFrame)
      reset()
    }
  }, [enabled])

  return frameRef
}
