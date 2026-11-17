import { useEffect } from 'react'
import { haptic } from '../../utils/haptic.js'
import { dragDrawer, getDrawerWidth, settleDrawer } from './drawerMotion.js'
import { closeMobileSider, openMobileSider, useMobileSider } from './mobileSiderState.js'

/** 左边缘起手的宽度；太宽会抢正文滚动。 */
const EDGE = 28
/** 横向移动超过该距离、且明显比纵向大时，进入拖动 */
const SLOP = 8
/** 纵向优先的取消阈值：斜着滚页面时不误开侧栏。 */
const VERTICAL_CANCEL = 12
/** 松手速度超过该值（进度/毫秒）就按甩动方向开合，否则按位置过半判断 */
const FLING_VELOCITY = 0.0012
/** 只用最近这段时间内的采样估算速度 */
const VELOCITY_WINDOW_MS = 90

type Sample = { x: number; t: number }

/**
 * 移动端抽屉手势：
 * - 收起时：从左边缘向右拖，抽屉跟着手指出来；
 * - 展开时：在任意位置向左拖，抽屉跟着手指收回。
 * 松手时按速度和位置决定开合，收尾动画衔接手指离开时的速度。
 * 监听全部 passive，纵向滚动优先，不会抢消息列表的滚动。
 */
export const useEdgeSwipe = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled) {
      return
    }
    let tracking = false
    let dragging = false
    let startOpen = false
    let startX = 0
    let startY = 0
    let width = 300
    let samples: Sample[] = []

    const progressAt = (x: number) => (startOpen ? 1 : 0) + (x - startX) / width

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        tracking = false
        return
      }
      // 在输入框里拖动光标、在弹窗上滑动，都不该开合侧栏
      if (
        event.target instanceof Element &&
        event.target.closest('input, textarea, [contenteditable="true"], [role="dialog"], [data-motion="fade"]')
      ) {
        tracking = false
        return
      }
      const touch = event.touches[0]
      startOpen = useMobileSider.getState().open
      if (!startOpen && touch.clientX > EDGE) {
        tracking = false
        return
      }
      tracking = true
      dragging = false
      startX = touch.clientX
      startY = touch.clientY
      samples = [{ x: touch.clientX, t: event.timeStamp }]
    }

    const onMove = (event: TouchEvent) => {
      if (!tracking || event.touches.length !== 1) {
        return
      }
      const touch = event.touches[0]
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY

      if (!dragging) {
        if (Math.abs(dy) > VERTICAL_CANCEL && Math.abs(dy) > Math.abs(dx)) {
          tracking = false
          return
        }
        // 展开时只认向左，收起时只认向右
        const towards = startOpen ? -dx : dx
        if (towards < SLOP || Math.abs(dx) < Math.abs(dy)) {
          return
        }
        dragging = true
        width = getDrawerWidth()
        // 只扣掉判定用的 SLOP：抽屉从原位起步，之后与手指保持同步
        startX += startOpen ? -SLOP : SLOP
      }

      samples.push({ x: touch.clientX, t: event.timeStamp })
      const cutoff = event.timeStamp - VELOCITY_WINDOW_MS
      while (samples.length > 2 && samples[0].t < cutoff) {
        samples.shift()
      }
      dragDrawer(progressAt(touch.clientX))
    }

    const onEnd = (event: TouchEvent) => {
      if (!tracking) {
        return
      }
      tracking = false
      if (!dragging) {
        return
      }
      dragging = false
      const last = samples.at(-1)
      const first = samples[0]
      const elapsed = last && first ? last.t - first.t : 0
      const velocity = elapsed > 0 && last && first ? (last.x - first.x) / width / elapsed : 0
      const x = event.changedTouches[0]?.clientX ?? last?.x ?? startX
      const progress = progressAt(x)
      const open =
        Math.abs(velocity) > FLING_VELOCITY ? velocity > 0 : progress > 0.5
      if (open !== startOpen) {
        haptic()
      }
      settleDrawer(open ? 1 : 0, velocity)
      if (open) {
        openMobileSider()
      } else {
        closeMobileSider()
      }
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    window.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [enabled])
}
