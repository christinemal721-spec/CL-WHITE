import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useIsMobile, useNoPageBounce } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { IconDataOutline16 } from '../base/icons.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList } from '../messages/MessageList.js'
import { RoundSelectBar } from '../messages/RoundSelectBar.js'
import { useRoundSelection } from '../messages/roundSelection.js'
import { ContextPanel } from './ContextPanel.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './SessionView.module.css'

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const selecting = useRoundSelection((state) => state.sessionId === session.id)
  const [swapped, setSwapped] = useState(false)
  useEffect(() => {
    if (selecting) {
      setSwapped(true)
    }
  }, [selecting])
  const isMobile = useIsMobile()
  const title = session.title || t('untitledChat')
  const [contextOpen, setContextOpen] = useState(false)
  const inputRef = useNoPageBounce<HTMLDivElement>(isMobile)
  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader title={title} onContext={() => setContextOpen(true)} />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            <span className={styles.titleText}>{title}</span>
          </div>
          <button
            className={styles.contextButton}
            type="button"
            onClick={() => setContextOpen(true)}
          >
            <IconDataOutline16 />
            {t('contextManagerButton')}
          </button>
        </div>
      )}
      <MessageList
        session={session}
        streaming={streaming}
        footer={
          <div ref={inputRef} className={styles.inputContainer}>
            {selecting ? (
              <RoundSelectBar session={session} />
            ) : (
              // 从多选退回时，输入框轻轻升起，而不是直接冒出来
              <div className={styles.inputSwap} data-motion={swapped ? 'rise' : undefined}>
                <ChatInput sessionId={session.id} />
                <div className={styles.caveat}>{t('contentCaveat')}</div>
              </div>
            )}
          </div>
        }
      />
      {contextOpen && (
        <ContextPanel session={session} onClose={() => setContextOpen(false)} />
      )}
    </div>
  )
}
