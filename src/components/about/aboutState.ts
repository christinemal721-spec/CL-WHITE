import { flushSync } from 'react-dom'
import { create } from 'zustand'
import { setOrigin } from '../historySearch/historySearchState.js'

type Rect = { top: number; left: number; width: number; height: number }

/** 「联系作者」页：和搜索页一样，从边栏按钮原地展开、缩回按钮 */
type AboutState = {
  open: boolean
  origin: Rect | null
  closing: 'shrink' | 'instant'
}

export const useAbout = create<AboutState>(() => ({
  open: false,
  origin: null,
  closing: 'shrink',
}))

let pageEl: HTMLElement | null = null

export const registerAboutPage = (page: HTMLElement | null) => {
  pageEl = page
}

export const openAbout = (from: Element | null) => {
  const rect = from?.getBoundingClientRect()
  const origin = rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null
  if (pageEl && origin) {
    // 起点瞬间就位，展开才是从按钮长出来
    pageEl.style.transition = 'none'
    setOrigin(pageEl, origin)
    void pageEl.getBoundingClientRect()
    pageEl.style.transition = ''
  }
  flushSync(() => useAbout.setState({ open: true, origin, closing: 'shrink' }))
}

export const closeAbout = (closing: 'shrink' | 'instant' = 'shrink') => {
  useAbout.setState({ open: false, closing })
}
