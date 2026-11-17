import {
  IconDataOutline16,
  IconMenuOutline20,
  IconNewChatOutline20,
} from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { newChat } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import { useNoPageBounce } from '../../app/viewport.js'
import styles from './MobileHeader.module.css'

/** 移动端顶栏：左侧菜单打开侧边栏；会话页再显示标题与开启新对话 */
export const MobileHeader = ({
  title,
  onContext,
}: {
  title?: string
  onContext?: () => void
}) => {
  const t = useTranslate()
  const ref = useNoPageBounce<HTMLDivElement>(true)
  return (
    <div ref={ref} className={styles.header}>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconMenuOutline20 />}
        aria-label={t('expandSiderbarButton')}
        onClick={openMobileSider}
      />
      {title === undefined ? null : (
        <>
          <div className={styles.title}>
            <span className={styles.titleText}>{title}</span>
          </div>
          {onContext ? (
            <IconButton
              size="xl"
              tone="primary"
              icon={<IconDataOutline16 />}
              aria-label={t('contextManagerButton')}
              onClick={onContext}
            />
          ) : null}
          <IconButton
            size="xl"
            tone="primary"
            icon={<IconNewChatOutline20 />}
            aria-label={t('newChat')}
            onClick={newChat}
          />
        </>
      )}
    </div>
  )
}
