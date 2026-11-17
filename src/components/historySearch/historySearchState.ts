import { flushSync } from 'react-dom'
import { create } from 'zustand'

type Rect = { top: number; left: number; width: number; height: number }

/** 历史搜索页：全局只有一份，挂在 App 上；从边栏「搜索」按钮原地展开 */
type HistorySearchState = {
  open: boolean
  /** 展开起点：按钮的位置，用于「从按钮长出来 / 缩回按钮」 */
  origin: Rect | null
  /** 关闭方式：shrink 缩回按钮；fade 原地淡出（选中结果、跳去别的会话时） */
  closing: 'shrink' | 'fade' | 'instant'
}

export const useHistorySearch = create<HistorySearchState>(() => ({
  open: false,
  origin: null,
  closing: 'shrink',
}))

let inputEl: HTMLInputElement | null = null
let pageEl: HTMLElement | null = null

export const registerSearchPage = (page: HTMLElement | null, input: HTMLInputElement | null) => {
  pageEl = page
  inputEl = input
}

const toRect = (el: Element | null): Rect | null => {
  if (!el) {
    return null
  }
  const { top, left, width, height } = el.getBoundingClientRect()
  return { top, left, width, height }
}

/** 先把起点写进页面、强制布局，再同步打开并聚焦：iOS 只有在点击回调里同步 focus 才会弹键盘 */
export const openHistorySearch = (from: Element | null) => {
  const origin = toRect(from)
  if (pageEl && origin) {
    // 起点要「瞬间」就位：关掉过渡写入按钮位置，强制布局后再恢复，展开才是从按钮长出来
    pageEl.style.transition = 'none'
    setOrigin(pageEl, origin)
    void pageEl.getBoundingClientRect()
    pageEl.style.transition = ''
  }
  flushSync(() => useHistorySearch.setState({ open: true, origin, closing: 'shrink' }))
  inputEl?.focus({ preventScroll: true })
}

export const closeHistorySearch = (closing: 'shrink' | 'fade' | 'instant' = 'shrink') => {
  inputEl?.blur()
  useHistorySearch.setState({ open: false, closing })
}

export const setOrigin = (page: HTMLElement, origin: Rect) => {
  const vw = window.innerWidth
  const vh = window.innerHeight
  page.style.setProperty('--from-top', `${Math.max(0, origin.top)}px`)
  page.style.setProperty('--from-left', `${Math.max(0, origin.left)}px`)
  page.style.setProperty('--from-right', `${Math.max(0, vw - origin.left - origin.width)}px`)
  page.style.setProperty('--from-bottom', `${Math.max(0, vh - origin.top - origin.height)}px`)
}
