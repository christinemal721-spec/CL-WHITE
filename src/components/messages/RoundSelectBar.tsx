import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import { deleteRounds, useChatStore } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { haptic } from '../../utils/haptic.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { endRoundSelection, setRounds, useRoundSelection } from './roundSelection.js'
import styles from './RoundSelectBar.module.css'

/** 多选删除时替换输入框的底栏：取消 / 已选数量 / 全选 / 删除（带确认）。 */
export const RoundSelectBar = ({ session }: { session: Session }) => {
  const t = useTranslate()
  const ids = useRoundSelection((state) => state.ids)
  const busy = useChatStore((state) => Boolean(state.streaming[session.id]))
  const [confirming, setConfirming] = useState(false)
  const allIds = getVisibleMessages(session)
    .filter((message) => message.role === 'user')
    .map((message) => message.id)
  const count = ids.filter((id) => allIds.includes(id)).length
  const allSelected = count > 0 && count === allIds.length

  const onConfirm = () => {
    const ok = deleteRounds(
      session.id,
      ids.filter((id) => allIds.includes(id))
    )
    setConfirming(false)
    if (ok) {
      haptic()
      endRoundSelection()
      showToast(t('deleteRoundsDone', { count }))
    } else {
      showToast({ type: 'error', key: 'deleteRoundsFailed' })
    }
  }

  return (
    <div data-motion="rise" className={styles.bar} role="toolbar" aria-label={t('deleteRoundsToolbar')}>
      <button type="button" className={styles.text} data-ripple onClick={endRoundSelection}>
        {t('cancel')}
      </button>
      <span className={styles.count} aria-live="polite">
        {t('deleteRoundsSelected', { count })}
      </span>
      <button
        type="button"
        className={styles.text}
        data-ripple
        onClick={() => setRounds(allSelected ? [] : allIds)}
      >
        {allSelected ? t('deleteRoundsNone') : t('deleteRoundsAll')}
      </button>
      <button
        type="button"
        className={styles.delete}
        data-ripple
        disabled={count === 0 || busy}
        onClick={() => setConfirming(true)}
      >
        {t('delete')}
      </button>
      {confirming ? (
        <Modal
          title={t('deleteRoundsConfirmTitle', { count })}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="outlined" size="m" autoFocus onClick={() => setConfirming(false)}>
                {t('cancel')}
              </Button>
              <Button variant="dangerOutlined" size="m" onClick={onConfirm}>
                {t('delete')}
              </Button>
            </>
          }
        >
          <div className={styles.confirmText}>{t('deleteRoundsConfirmDescription')}</div>
        </Modal>
      ) : null}
    </div>
  )
}
