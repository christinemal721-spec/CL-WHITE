/**
 * 移动端抽屉的位置控制。
 *
 * 拖动时每帧直接写 transform / opacity，不经过 React 渲染；
 * 松手或点按钮开合时加上过渡，由 CSS 在合成线程上完成动画。
 * 进度 progress：0 = 完全收起，1 = 完全展开。
 */

/** 主界面跟随抽屉向右退让的距离，形成层次感 */
const MAIN_SHIFT = 56
/** 主界面在抽屉完全展开时缩小的比例 */
const MAIN_SCALE = 0.04
/** 收尾曲线：起步快、收得柔，接近 iOS 原生抽屉的手感 */
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

type Dom = {
  drawer: HTMLElement
  mask: HTMLElement
}

let dom: Dom | null = null
let progress = 0
/** 手指正在拖动（位置还没有落定） */
let dragging = false
let hideTimer: ReturnType<typeof setTimeout> | undefined

const getMain = () => document.querySelector<HTMLElement>('[data-drawer-main]')

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

const setTransition = (elements: (HTMLElement | null)[], duration: number) => {
  const value =
    duration > 0
      ? `transform ${duration}ms ${EASE}, opacity ${duration}ms ${EASE}, border-radius ${duration}ms ${EASE}`
      : 'none'
  for (const element of elements) {
    if (element) {
      element.style.transition = value
    }
  }
}

const show = (visible: boolean) => {
  if (!dom) {
    return
  }
  dom.drawer.style.visibility = visible ? 'visible' : 'hidden'
  dom.mask.style.visibility = visible ? 'visible' : 'hidden'
}

const paint = (value: number) => {
  if (!dom) {
    return
  }
  const main = getMain()
  dom.drawer.style.transform = `translate3d(${(value - 1) * 100}%, 0, 0)`
  dom.mask.style.opacity = String(value)
  dom.mask.style.pointerEvents = value > 0.01 ? 'auto' : 'none'
  if (main) {
    if (value > 0) {
      main.style.transform = `translate3d(${value * MAIN_SHIFT}px, 0, 0) scale(${1 - value * MAIN_SCALE})`
      main.style.borderRadius = `${value * 18}px`
      main.style.overflow = 'hidden'
    } else {
      // 收起后彻底清掉，避免 transform 影响内部 fixed / sticky 元素
      main.style.removeProperty('transform')
      main.style.removeProperty('border-radius')
      main.style.removeProperty('overflow')
    }
  }
}

export const registerDrawer = (next: Dom | null) => {
  dom = next
  if (dom) {
    setTransition([dom.drawer, dom.mask, getMain()], 0)
    paint(progress)
    show(progress > 0)
  }
}

export const getDrawerWidth = () => dom?.drawer.offsetWidth || 300

/** 拖动中：跟手，无过渡 */
export const dragDrawer = (value: number) => {
  clearTimeout(hideTimer)
  dragging = true
  progress = Math.max(0, Math.min(1, value))
  if (!dom) {
    return
  }
  show(true)
  setTransition([dom.drawer, dom.mask, getMain()], 0)
  paint(progress)
}

/**
 * 动画到目标位置。velocity（进度/毫秒）用来缩短快速甩动时的时长，
 * 让收尾速度和手指离开时的速度衔接上。
 */
export const settleDrawer = (target: 0 | 1, velocity = 0) => {
  // 已经在去往目标的路上（例如松手后状态同步过来），不要打断正在进行的动画
  if (!dragging && target === progress) {
    return
  }
  dragging = false
  clearTimeout(hideTimer)
  const from = progress
  progress = target
  if (!dom) {
    return
  }
  const distance = Math.abs(target - from)
  let duration = reducedMotion() ? 120 : 380 * Math.max(0.45, distance)
  if (Math.abs(velocity) > 0.001) {
    duration = Math.min(duration, Math.max(180, (distance / Math.abs(velocity)) * 2.2))
  }
  show(true)
  setTransition([dom.drawer, dom.mask, getMain()], distance < 0.001 ? 0 : duration)
  paint(target)
  if (target === 0) {
    hideTimer = setTimeout(() => {
      if (progress === 0) {
        show(false)
        setTransition([dom?.drawer ?? null, dom?.mask ?? null, getMain()], 0)
      }
    }, duration + 40)
  }
}
