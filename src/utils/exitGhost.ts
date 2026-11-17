import { useLayoutEffect, type RefObject } from 'react'

/**
 * 退场影子：元素被 React 卸载的那一刻，原地复制一份（带 data-exiting），
 * 让它按 data-motion 播放退场动画后再移除。组件不用改成「延迟卸载」，
 * 所有弹窗、菜单、面板都能统一有关闭过渡。
 * 影子不可交互（inert + pointer-events: none），并保留内部滚动位置，避免关闭时内容跳动。
 */
const EXIT_MS = 240

const scrollOf = new WeakMap<Element, number>()

const ghost = (el: HTMLElement, parent: Node | null, next: Node | null) => {
  const target = el.isConnected ? el.parentNode : parent
  if (!target || !(target as Node).isConnected) {
    return
  }
  const clone = el.cloneNode(true) as HTMLElement
  clone.setAttribute('data-exiting', '')
  clone.setAttribute('aria-hidden', 'true')
  clone.inert = true
  clone.removeAttribute('id')
  clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'))
  const anchor = el.isConnected ? el.nextSibling : next?.isConnected ? next : null
  target.insertBefore(clone, anchor)
  // 还原内部滚动位置（克隆出来的节点滚动都是 0）
  const from = [el, ...el.querySelectorAll('*')]
  const to = [clone, ...clone.querySelectorAll('*')]
  from.forEach((node, index) => {
    const top = node.isConnected ? node.scrollTop : (scrollOf.get(node) ?? 0)
    if (top > 0 && to[index]) {
      to[index].scrollTop = top
    }
  })
  window.setTimeout(() => clone.remove(), EXIT_MS)
}

/** 记录元素内部滚动，卸载后已经脱离文档时也能还原 */
const trackScroll = (el: HTMLElement) => {
  const onScroll = (event: Event) => {
    if (event.target instanceof Element) {
      scrollOf.set(event.target, event.target.scrollTop)
    }
  }
  el.addEventListener('scroll', onScroll, { capture: true, passive: true })
  return () => el.removeEventListener('scroll', onScroll, { capture: true })
}

/**
 * active 为 true 时挂上；active 变 false 或组件卸载时为 ref 指向的元素生成退场影子。
 * 例：useExitGhost(floatingRef, open)；整个组件条件渲染时 active 传 true 即可。
 */
export const useExitGhost = (
  ref: RefObject<HTMLElement | null>,
  active = true,
  /** 变化时视为换了一个元素（例如按 key 重建的提示） */
  identity?: unknown
) => {
  useLayoutEffect(() => {
    const el = ref.current
    if (!active || !el) {
      return
    }
    const parent = el.parentNode
    const next = el.nextSibling
    const untrack = trackScroll(el)
    return () => {
      untrack()
      ghost(el, parent, next)
    }
  }, [active, ref, identity])
}
