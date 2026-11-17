import clsx from 'clsx'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { useExitGhost } from '../../utils/exitGhost.js'
import { haptic } from '../../utils/haptic.js'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { IconCloseOutline16 } from './icons.js'
import { IconButton } from './IconButton.js'
import styles from './Modal.module.css'

/** 当前打开的弹窗，后打开的在末尾；叠放时 Esc 只关闭最上层 */
const openModals: object[] = []

/** 拖动时不接管的控件：滑块、输入框里拖动有自己的含义 */
const NO_DRAG = 'input[type="range"], textarea, input[type="text"], input[type="number"], select, [data-no-sheet-drag]'

/** 从 target 往上到 root（不含）之间，有没有已经往下滚过的滚动容器 */
const scrolledAbove = (target: Element, root: Element) => {
  for (let node: Element | null = target; node && node !== root; node = node.parentElement) {
    if (node.scrollTop > 0 && node.scrollHeight > node.clientHeight) {
      return true
    }
  }
  return false
}

/**
 * 手机上的底部面板：向下拖动跟手，拖过一段距离或快速下甩就关闭，否则弹回。
 * 内容已经往下滚过时先滚回顶部，再拖才算关闭；左右滑动留给面板内部（设置切换分组）。
 */
const useSheetDrag = (
  enabled: boolean,
  overlayRef: { current: HTMLDivElement | null },
  contentRef: { current: HTMLDivElement | null },
  onCloseRef: { current: () => void }
) => {
  useEffect(() => {
    const overlay = overlayRef.current
    const content = contentRef.current
    if (!enabled || !overlay || !content) {
      return
    }
    const mobile = () => !window.matchMedia('(min-width: 768px)').matches
    let drag: { x: number; y: number; time: number; dy: number; active: boolean | null } | null =
      null
    /** 最近一次移动的速度（px/ms）与时间，用来判断是不是「下甩」 */
    let lastMove = { y: 0, time: 0, velocity: 0 }
    const restore = () => {
      content.style.transition = ''
      content.style.transform = ''
      overlay.style.transition = ''
      overlay.style.backgroundColor = ''
    }
    const onStart = (event: TouchEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (
        !mobile() ||
        event.touches.length !== 1 ||
        !target ||
        target.closest(NO_DRAG) ||
        scrolledAbove(target, content)
      ) {
        drag = null
        return
      }
      const touch = event.touches[0]
      drag = { x: touch.clientX, y: touch.clientY, time: event.timeStamp, dy: 0, active: null }
      lastMove = { y: touch.clientY, time: event.timeStamp, velocity: 0 }
    }
    const onMove = (event: TouchEvent) => {
      if (!drag) {
        return
      }
      const touch = event.touches[0]
      const dx = touch.clientX - drag.x
      const dy = touch.clientY - drag.y
      if (drag.active === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
          return
        }
        // 只接管明显向下的拖动；向上是滚动，横向是切换分组
        drag.active = dy > 0 && dy > Math.abs(dx) * 1.2
        if (!drag.active) {
          drag = null
          return
        }
        content.style.transition = 'none'
        overlay.style.transition = 'none'
      }
      event.preventDefault()
      drag.dy = Math.max(0, dy)
      const elapsed = event.timeStamp - lastMove.time
      if (elapsed > 0) {
        lastMove = {
          y: touch.clientY,
          time: event.timeStamp,
          velocity: (touch.clientY - lastMove.y) / elapsed,
        }
      }
      content.style.transform = `translateY(${drag.dy}px)`
      const fade = 1 - Math.min(1, drag.dy / Math.max(1, content.offsetHeight))
      overlay.style.backgroundColor = `rgba(0, 0, 0, calc(var(--overlay-opacity) * ${fade}))`
    }
    const onEnd = (event: TouchEvent) => {
      if (!drag?.active) {
        drag = null
        return
      }
      const { dy } = drag
      drag = null
      // 只看最后一小段的速度：慢慢拖下去又停住不算甩
      const velocity = event.timeStamp - lastMove.time < 80 ? lastMove.velocity : 0
      const height = content.offsetHeight
      if (dy > Math.min(160, height * 0.25) || (velocity > 0.5 && dy > 24) || dy > height * 0.5) {
        haptic()
        const ease = 'cubic-bezier(0.4, 0, 1, 1)'
        content.style.transition = `transform 200ms ${ease}`
        content.style.transform = `translateY(${height + 24}px)`
        overlay.style.transition = `background-color 200ms ${ease}`
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0)'
        // 已经自己滑出去了，退场影子不再播放动画
        overlay.setAttribute('data-dismissed', '')
        window.setTimeout(() => onCloseRef.current(), 190)
      } else {
        const ease = 'cubic-bezier(0.22, 1, 0.36, 1)'
        content.style.transition = `transform 300ms ${ease}`
        content.style.transform = 'translateY(0)'
        overlay.style.transition = `background-color 300ms ${ease}`
        overlay.style.backgroundColor = ''
        window.setTimeout(restore, 320)
      }
    }
    content.addEventListener('touchstart', onStart, { passive: true })
    content.addEventListener('touchmove', onMove, { passive: false })
    content.addEventListener('touchend', onEnd)
    content.addEventListener('touchcancel', onEnd)
    return () => {
      content.removeEventListener('touchstart', onStart)
      content.removeEventListener('touchmove', onMove)
      content.removeEventListener('touchend', onEnd)
      content.removeEventListener('touchcancel', onEnd)
    }
  }, [enabled, overlayRef, contentRef, onCloseRef])
}

/** 遮罩 + 居中卡片，Esc / 点遮罩关闭 */
export const Modal = ({
  title,
  children,
  footer,
  closable = false,
  className,
  mainClassName,
  motion = 'pop',
  onClose,
}: {
  title: ReactNode
  children?: ReactNode
  footer?: ReactNode
  /** 标题栏右侧显示关闭按钮 */
  closable?: boolean
  className?: string
  /** 内容区的 class */
  mainClassName?: string
  /** pop：居中浮现；sheet：桌面浮现、手机从底部升起 */
  motion?: 'pop' | 'sheet'
  onClose: () => void
}) => {
  const t = useTranslate()
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  const overlayRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  useExitGhost(overlayRef)
  useSheetDrag(motion === 'sheet', overlayRef, contentRef, onCloseRef)
  onCloseRef.current = onClose
  useEffect(() => {
    const token = {}
    openModals.push(token)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && openModals.at(-1) === token) {
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      openModals.splice(openModals.indexOf(token), 1)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return createPortal(
    <div
      ref={overlayRef}
      className={styles.overlay}
      data-motion="fade"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={contentRef}
        className={clsx(styles.content, className)}
        data-motion={motion}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {motion === 'sheet' ? <div className={styles.grabber} aria-hidden="true" /> : null}
        <div className={styles.header}>
          <div id={titleId} className={styles.title}>
            {title}
          </div>
          {closable ? (
            <IconButton
              className={styles.close}
              tone="primary"
              icon={<IconCloseOutline16 />}
              aria-label={t('close')}
              onClick={onClose}
            />
          ) : null}
        </div>
        {children ? <div className={clsx(styles.main, mainClassName)}>{children}</div> : null}
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>,
    document.body
  )
}
