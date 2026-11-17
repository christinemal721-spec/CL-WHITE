/**
 * 微光涟漪：按下图标按钮时，从按钮中心扩散出一圈冰蓝细光环再淡出。
 *
 * 在 pointerdown 时就生成，轻点一下也能完整播完（约 0.45 秒），
 * 不依赖 :active（iOS 上快速轻点几乎看不到 :active）。
 * 光环挂在 body 上、按视口坐标定位，不受按钮所在容器的裁剪和变换影响。
 *
 * 哪些按钮有涟漪：带 data-ripple 属性的按钮（IconButton、发送、麦克风、回到底部等）。
 */
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

const spawn = (button: Element) => {
  const rect = button.getBoundingClientRect()
  if (rect.width === 0) {
    return
  }
  const size = Math.max(rect.width, rect.height)
  const ring = document.createElement('span')
  ring.className = 'white-ripple'
  ring.style.left = `${rect.left + rect.width / 2 - size / 2}px`
  ring.style.top = `${rect.top + rect.height / 2 - size / 2}px`
  ring.style.width = `${size}px`
  ring.style.height = `${size}px`
  ring.addEventListener('animationend', () => ring.remove(), { once: true })
  // 动画事件意外丢失时也要清掉
  setTimeout(() => ring.remove(), 800)
  document.body.appendChild(ring)
}

export const setupRipple = () => {
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!event.isPrimary || event.button > 0 || reducedMotion.matches) {
        return
      }
      const target = event.target instanceof Element ? event.target : null
      const button = target?.closest('[data-ripple]')
      if (!button || button.matches(':disabled, [aria-disabled="true"]')) {
        return
      }
      spawn(button)
    },
    { passive: true, capture: true }
  )
}
