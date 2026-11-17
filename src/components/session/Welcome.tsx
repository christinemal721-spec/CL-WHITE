import { useState } from 'react'
import { useIsMobile, useNoPageBounce } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { useChatStore } from '../../services/chat/store.js'
import { Signature } from '../base/Signature.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

/** 离开超过这么久才说「你回来了」 */
const RETURN_AFTER_MS = 30 * 60 * 1000

/** 新对话：签名 + 问候 + 输入框。桌面端居中；移动端输入框吸底 */
/** 开屏后的第一次欢迎页已经用过「直接显示」，之后回到欢迎页照常书写 */
let splashConsumed = false

export const Welcome = () => {
  const t = useTranslate()
  // 冷启动时签名已经在开屏里写过一遍：这次欢迎页直接显示，之后再回到欢迎页照常书写
  // 这次打开播过开屏：欢迎页第一次出现时直接显示签名（开屏还在时由它接力过来），
  // 即使脚本加载慢、开屏已经先淡出，也不再重写一遍
  const [signatureMotion] = useState<'write' | 'still'>(() => {
    const splashed = (window as { __whiteSplash?: boolean }).__whiteSplash === true
    if (splashed && !splashConsumed) {
      splashConsumed = true
      return 'still'
    }
    return 'write'
  })
  const isMobile = useIsMobile()
  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 440
  const ref = useNoPageBounce<HTMLDivElement>(isMobile)
  const sessions = useChatStore((state) => state.sessions)
  // 只在打开时算一次，避免停留期间文案跳动
  const [now] = useState(Date.now)
  const lastUpdated = sessions.reduce((latest, session) => Math.max(latest, session.updatedAt), 0)
  const gap = lastUpdated ? now - lastUpdated : 0

  let greeting = t('whiteFirstMeet')
  let since: string | null = null
  if (lastUpdated && gap >= RETURN_AFTER_MS) {
    greeting = t('whiteReturned')
    const minutes = Math.floor(gap / 60000)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    const time =
      days > 0
        ? t('whiteDays', { d: days, h: hours % 24 })
        : hours > 0
          ? t('whiteHours', { h: hours, m: minutes % 60 })
          : t('whiteMinutes', { m: minutes })
    since = t('whiteSinceLast', { time })
  } else if (lastUpdated) {
    greeting = t('whiteListening')
  }

  return (
    <div ref={ref} className={styles.container}>
      {isMobile ? <MobileHeader /> : null}
      <div className={styles.welcome}>
        <div className={styles.hero}>
          <Signature
            className={styles.signature}
            width={isNarrow ? 140 : 168}
            motion={signatureMotion}
            splashTarget={signatureMotion === 'still'}
            alt={t('whiteSignatureAlt')}
          />
          <div className={styles.greeting}>{greeting}</div>
          {since ? <div className={styles.since}>{since}</div> : null}
        </div>
        <ChatInput sessionId={null} />
        {isMobile ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}
