import clsx from 'clsx'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useChatStore } from '../../services/chat/store.js'
import { haptic } from '../../utils/haptic.js'
import { Button } from './Button.js'
import {
  IconDownloadOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconPinOutline16,
  IconRefreshOutline16,
} from './icons.js'
import { acknowledged, useSplashDone } from './IntroNotice.js'
import { Modal } from './Modal.js'
import styles from './IntroNotice.module.css'

/** 当前这条更新公告对应的版本；改了内容就换版本号，老用户会再看到一次 */
const NOTICE_VERSION = '1.0.4'
const KEY = 'chat-demo:update-notice'

const readSeen = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return NOTICE_VERSION
  }
}

const markSeen = () => {
  try {
    localStorage.setItem(KEY, NOTICE_VERSION)
  } catch {
    // 存不了就算了，下次打开再提示一次
  }
}

/** 「【…】」里的字加粗，括号去掉（公告里括号会和「」叠在一起） */
const emphasize = (text: string): ReactNode[] =>
  text.split(/(【[^】]*】)/).map((part, index) =>
    part.startsWith('【') ? <strong key={index}>{part.slice(1, -1)}</strong> : part
  )

/** 连选：两端的小圆点连成一段 */
const IconRange = () => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="3" r="1.9" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="8" cy="13" r="1.9" stroke="currentColor" strokeWidth="1.3" />
    <path d="M8 5v6" stroke="currentColor" strokeWidth="1.3" strokeDasharray="1.6 1.6" />
  </svg>
)

/**
 * 版本更新公告：老用户更新后弹一次，点「知道了」不再出现。
 * 新用户已经有第一次使用说明，直接记为看过，不再叠一层弹窗。
 * 正在生成回答时先不弹，等生成完。
 */
export const UpdateNotice = () => {
  const t = useTranslate()
  const [open, setOpen] = useState(() => {
    if (readSeen() === NOTICE_VERSION) {
      return false
    }
    if (!acknowledged()) {
      markSeen()
      return false
    }
    return true
  })
  const splashDone = useSplashDone()
  const busy = useChatStore((state) => Object.keys(state.streaming).length > 0)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!open || !splashDone || busy) {
      return
    }
    const timer = setTimeout(() => setReady(true), 360)
    return () => clearTimeout(timer)
  }, [open, splashDone, busy])
  if (!open || !ready) {
    return null
  }
  const confirm = () => {
    markSeen()
    haptic()
    setOpen(false)
  }
  // 最要紧的两条（习惯变了、最常用的新功能）放最前面并高亮
  const items = [
    { icon: <IconEllipsisOutline16 />, title: t('updateLongPressTitle'), text: t('updateLongPress'), key: true },
    { icon: <IconDownloadOutline16 />, title: t('updateExportTitle'), text: t('updateExport'), key: true },
    { icon: <IconPinOutline16 />, title: t('updatePinTitle'), text: t('updatePin') },
    { icon: <IconRange />, title: t('updateRangeTitle'), text: t('updateRange') },
    { icon: <IconEditOutline16 />, title: t('updateEditTitle'), text: t('updateEdit') },
    { icon: <IconRefreshOutline16 />, title: t('updateFlashTitle'), text: t('updateFlash') },
  ]
  return (
    <Modal
      title={
        <div className={styles.hero}>
          <span className={styles.heading}>{t('updateTitle', { version: NOTICE_VERSION })}</span>
          <em className={styles.motto}>{t('updateSubtitle')}</em>
        </div>
      }
      className={styles.dialog}
      onClose={confirm}
      footer={
        <Button size="m" block onClick={confirm}>
          {t('updateConfirm')}
        </Button>
      }
    >
      <ol className={clsx(styles.body, styles.compact)}>
        {items.map((item, index) => (
          <li
            key={item.title}
            className={clsx(styles.item, item.key && styles.itemKey)}
            style={{ '--i': index } as CSSProperties}
          >
            <span className={clsx(styles.icon, 'white-glass')} aria-hidden="true">
              {item.icon}
            </span>
            <div className={styles.itemBody}>
              <div className={styles.itemTitle}>{item.title}</div>
              <p>{emphasize(item.text)}</p>
            </div>
          </li>
        ))}
      </ol>
    </Modal>
  )
}
