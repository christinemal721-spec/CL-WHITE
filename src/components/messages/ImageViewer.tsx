import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import styles from './ImageViewer.module.css'

/**
 * 图片放大预览：在当前页面上盖一层，不跳转新页面。
 * 点空白处或右上角关闭，Esc 关闭；点图片在「适应屏幕 / 放大」之间切换，放大后可拖动查看。
 */
export const ImageViewer = ({
  src,
  alt,
  onClose,
}: {
  src: string
  alt: string
  onClose: () => void
}) => {
  const t = useTranslate()
  const [zoomed, setZoomed] = useState(false)
  const [closing, setClosing] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)

  const close = () => {
    setClosing(true)
    setTimeout(onClose, 180)
  }
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeRef.current()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  // 放大后把画面移到正中，而不是停在左上角
  useEffect(() => {
    const stage = stageRef.current
    if (stage && zoomed) {
      stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2
      stage.scrollTop = (stage.scrollHeight - stage.clientHeight) / 2
    }
  }, [zoomed])

  return createPortal(
    <div
      className={styles.viewer}
      data-closing={closing ? '' : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <div
        ref={stageRef}
        className={styles.stage}
        data-zoomed={zoomed ? '' : undefined}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            close()
          }
        }}
      >
        <img
          className={styles.picture}
          src={src}
          alt={alt}
          draggable={false}
          onClick={() => setZoomed((value) => !value)}
        />
      </div>
      <button type="button" className={styles.close} aria-label={t('close')} onClick={close}>
        ×
      </button>
    </div>,
    document.body
  )
}
