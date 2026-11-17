import clsx from 'clsx'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconMailOutline16,
  IconPanelLeftOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { openAbout } from '../about/aboutState.js'
import { overdueDays, snoozeBackupReminder, useBackupReminder } from '../../services/backupReminder.js'
import { ExportSessionModal } from './ExportSessionModal.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { newChat, removeSession, useChatStore } from '../../services/chat/store.js'
import { openHistorySearch } from '../historySearch/historySearchState.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Signature } from '../base/Signature.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { registerDrawer, settleDrawer } from './drawerMotion.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import styles from './Sider.module.css'

/** 展开的侧边栏：名称与收起按钮、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const unread = useChatStore((state) => state.unread)
  const [now, setNow] = useState(Date.now)
  const groups = useMemo(() => groupSessions(sessions, now, t), [sessions, now, t])
  const reminder = useBackupReminder()
  const overdue = sessions.length ? overdueDays(reminder, now) : null
  const [exporting, setExporting] = useState<SessionSummary | null>(null)
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <h1 className={styles.appName}>
          <Signature width={96} motion="still" glow={false} alt={t('appName')} />
        </h1>
        <IconButton
          size="m"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('collapseSiderbarButton')}
          tooltipPlacement="bottom"
          onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
        />
      </div>
      <button
        type="button"
        className={styles.newChat}
        onClick={() => {
          newChat()
          closeMobileSider()
        }}
      >
        <span className={styles.newChatIcon}>
          <NewChatIcon />
        </span>
        {t('newChat')}
      </button>
      <div className={styles.listWrap}>
        <div className={styles.list}>
          {groups.map((group) => (
              <div key={group.key} className={styles.section}>
                <div className={styles.sectionHeader}>{group.label}</div>
                {group.sessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    active={session.id === activeId}
                    unread={Boolean(unread[session.id])}
                    onDelete={() => setDeleting(session)}
                    onExport={() => setExporting(session)}
                  />
                ))}
              </div>
            ))}
        </div>
      </div>
      {overdue !== null ? (
        <div className={styles.reminder} role="status">
          <span className={styles.reminderDot} aria-hidden="true" />
          <span className={styles.reminderText}>
            {reminder.lastExportAt
              ? t('backupReminderText', { days: overdue })
              : t('backupReminderNever')}
          </span>
          <button
            type="button"
            className={styles.reminderGo}
            onClick={() => {
              closeMobileSider()
              openSettings('data')
            }}
          >
            {t('backupReminderGo')}
          </button>
          <button
            type="button"
            className={styles.reminderLater}
            aria-label={t('backupReminderLater')}
            onClick={snoozeBackupReminder}
          >
            ×
          </button>
        </div>
      ) : null}
      <div className={styles.bottom}>
        <button
          type="button"
          className={styles.settings}
          aria-label={t('historySearchTitle')}
          onClick={(event) => openHistorySearch(event.currentTarget)}
        >
          <span className={styles.settingsIcon}>
            <IconSearchOutline16 />
          </span>
          <span className={styles.settingsLabel}>{t('siderSearch')}</span>
        </button>
        <button type="button" className={styles.settings} onClick={() => {
            // 移动端：打开设置时收起边栏，关掉设置后直接回到对话
            closeMobileSider()
            openSettings('general')
          }}>
          <span className={styles.settingsIcon}>
            <IconSettingsOutline16 />
          </span>
          <span className={styles.settingsLabel}>{t('settings')}</span>
        </button>
        <button
          type="button"
          className={styles.settings}
          aria-label={t('aboutTitle')}
          onClick={(event) => openAbout(event.currentTarget)}
        >
          <span className={styles.settingsIcon}>
            <IconMailOutline16 />
          </span>
          <span className={styles.settingsLabel}>{t('siderAbout')}</span>
        </button>
      </div>
      {exporting ? (
        <ExportSessionModal session={exporting} onClose={() => setExporting(null)} />
      ) : null}
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：浮在页面上方，点空白区域关闭。 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  const drawerRef = useRef<HTMLDivElement>(null)
  const maskRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const drawer = drawerRef.current
    const mask = maskRef.current
    if (!drawer || !mask) {
      return
    }
    registerDrawer({ drawer, mask })
    return () => registerDrawer(null)
  }, [])

  // 按钮、点遮罩、切换会话等开合：动画到对应位置（手势松手时已提前落定，这里不会重复）
  useEffect(() => {
    settleDrawer(open ? 1 : 0)
  }, [open])

  return (
    <>
      <div ref={maskRef} className={styles.drawerMask} onClick={closeMobileSider} />
      <div ref={drawerRef} className={styles.drawer} aria-hidden={!open}>
        <Sider mobile />
      </div>
    </>
  )
}
