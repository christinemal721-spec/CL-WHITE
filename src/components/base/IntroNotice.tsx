import clsx from 'clsx'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { haptic } from '../../utils/haptic.js'
import { Button } from './Button.js'
import { IconDownloadOutline16, IconRefreshOutline16 } from './icons.js'
import { Modal } from './Modal.js'
import { Signature } from './Signature.js'
import styles from './IntroNotice.module.css'

/** 免费：一枚小小的「0」硬币 */
const IconFree = () => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6.35" stroke="currentColor" strokeWidth="1.3" />
    <ellipse cx="8" cy="8" rx="2.1" ry="3" stroke="currentColor" strokeWidth="1.3" />
  </svg>
)

const KEY = 'chat-demo:intro-ack'

/** 第一次使用说明是否已经点过「我已知晓」（新用户为 false） */
export const acknowledged = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return true
  }
}

/** 「【…】」里的字加粗（括号保留） */
export const emphasize = (text: string): ReactNode[] =>
  text.split(/(【[^】]*】)/).map((part, index) =>
    part.startsWith('【') ? <strong key={index}>{part}</strong> : part
  )

/** 等开屏动画结束（#white-splash 被移除）再出现，避免压在签名上 */
export const useSplashDone = () => {
  const [done, setDone] = useState(() => !document.getElementById('white-splash'))
  useEffect(() => {
    if (done) {
      return
    }
    const check = () => {
      if (!document.getElementById('white-splash')) {
        setDone(true)
      }
    }
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true })
    // 兜底：开屏脚本出意外时也不至于一直不弹
    const timer = setTimeout(() => setDone(true), 4000)
    return () => {
      observer.disconnect()
      clearTimeout(timer)
    }
  }, [done])
  return done
}

/** 第一次打开时的使用说明，点「我已知晓」后不再出现 */
export const IntroNotice = () => {
  const t = useTranslate()
  const [open, setOpen] = useState(() => !acknowledged())
  const splashDone = useSplashDone()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!open || !splashDone) {
      return
    }
    // 开屏签名接力到欢迎页后稍停一下再弹
    const timer = setTimeout(() => setReady(true), 260)
    return () => clearTimeout(timer)
  }, [open, splashDone])
  if (!open || !ready) {
    return null
  }
  const confirm = () => {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      // 存不了也照常关闭，下次打开再提示
    }
    haptic()
    setOpen(false)
  }
  return (
    <Modal
      title={
        <div className={styles.hero}>
          {/* 装饰用，不读进弹窗标题 */}
          <span aria-hidden="true" className={styles.logo}>
            <Signature width={124} motion="write" alt="" />
          </span>
          <span className={styles.heading}>{t('introTitle')}</span>
          <em className={styles.motto}>{t('introMotto')}</em>
        </div>
      }
      className={styles.dialog}
      // 必须点按钮确认，Esc 和点遮罩都不关
      onClose={() => undefined}
      footer={
        <Button size="m" block onClick={confirm}>
          {t('introConfirm')}
        </Button>
      }
    >
      <ol className={styles.body}>
        {[
          { icon: <IconDownloadOutline16 />, title: t('introLocalTitle'), text: t('introLocal') },
          { icon: <IconRefreshOutline16 />, title: t('introUpdateTitle'), text: t('introUpdate') },
          { icon: <IconFree />, title: t('introFreeTitle'), text: t('introFree') },
        ].map((item, index) => (
          <li key={item.title} className={styles.item} style={{ '--i': index } as CSSProperties}>
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
