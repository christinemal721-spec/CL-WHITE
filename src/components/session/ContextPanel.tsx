import clsx from 'clsx'
import { useMemo, useRef, useState } from 'react'
import { useExitGhost } from '../../utils/exitGhost.js'
import { useTranslate } from '../../i18n/index.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import { estimateTokens } from '../../services/chat/context.js'
import { getContextRounds, getReplyText } from '../../services/chat/reply.js'
import {
  setContextCompress,
  setContextExcluded,
  setContextExcludedMany,
} from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { validCompaction } from '../../services/chat/compaction.js'
import { setAutoCompact, useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import styles from './ContextPanel.module.css'

const preview = (text: string, fallback: string) => {
  const line = (text || '').replace(/\s+/g, ' ').trim()
  return line ? (line.length > 72 ? `${line.slice(0, 72)}…` : line) : fallback
}

const QUICK_COUNTS = [20, 50, 100, 500, 800]

/**
 * 单窗口上下文管理：
 * - 逐轮勾选，排除后不再进入请求；
 * - 把最早 N 轮压成摘要，其余原样发送；默认 0 即纯官方语义。
 */
export const ContextPanel = ({ session, onClose }: { session: Session; onClose: () => void }) => {
  const t = useTranslate()
  const maskRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  useExitGhost(maskRef)
  useExitGhost(panelRef)
  const rounds = useMemo(() => getContextRounds(getVisibleMessages(session)), [session])
  const excluded = useMemo(() => new Set(session.contextExcluded ?? []), [session.contextExcluded])
  const compress = session.contextCompress ?? 0
  const autoCompact = useSettings((state) => state.autoCompact)
  const compaction = useMemo(
    () => validCompaction(session, getVisibleMessages(session)),
    [session]
  )
  const compactedIds = useMemo(() => new Set(compaction?.msgIds ?? []), [compaction])
  const [compressInput, setCompressInput] = useState(compress ? String(compress) : '')
  /** 打开自动压缩前先确认：它是全局设置，对所有对话生效 */
  const [confirmingAuto, setConfirmingAuto] = useState(false)
  const tokens = rounds.reduce(
    (sum, [user, reply]) =>
      sum + estimateTokens(user.content) + estimateTokens(getReplyText(reply)),
    0
  )

  const allIds = rounds.map(([user]) => user.id)

  const applyCompress = (value: number) => {
    const next = Math.max(0, Math.min(rounds.length, Math.floor(value) || 0))
    setContextCompress(session.id, next)
    setCompressInput(next ? String(next) : '')
  }

  const toggleAuto = (enabled: boolean) => {
    if (enabled) {
      setConfirmingAuto(true)
    } else {
      setAutoCompact(false)
    }
  }

  /** 只带最近 count 轮：更早的全部取消勾选 */
  const keepRecent = (count: number) => {
    const olderIds = allIds.slice(0, -count)
    if (olderIds.length) {
      setContextExcludedMany(session.id, olderIds, true)
    }
    setContextExcludedMany(session.id, allIds.slice(-count), false)
  }

  return (
    <>
      <div ref={maskRef} data-motion="fade" className={styles.mask} onClick={onClose} />
      <aside
        ref={panelRef}
        data-motion="panel"
        className={styles.panel}
        role="dialog"
        aria-label={t('contextManagerTitle')}
      >
        <header className={styles.head}>
          <div className={styles.headText}>
            <div className={styles.title}>{t('contextManagerTitle')}</div>
            <div className={styles.sub}>
              {t('contextRounds', { count: rounds.length })} ·{' '}
              {t('contextTokens', { count: tokens })}
            </div>
            {autoCompact && compaction ? (
              <div className={styles.sub}>
                {t('contextCompactionStatus', { count: compaction.msgIds.length })}
              </div>
            ) : null}
            {compress > 0 ? (
              <div className={styles.sub}>{t('contextCompressStatus', { count: compress })}</div>
            ) : null}
          </div>
          <button
            className={styles.close}
            type="button"
            data-ripple
            onClick={onClose}
            aria-label={t('close')}
          >
            ×
          </button>
        </header>

        <section className={styles.compress}>
          <div className={styles.compressLabel}>{t('contextCompressLabel')}</div>
          <div className={styles.compressRow}>
            <input
              className={styles.compressInput}
              type="number"
              inputMode="numeric"
              min={0}
              max={rounds.length}
              placeholder="0"
              value={compressInput}
              onChange={(event) => setCompressInput(event.target.value)}
            />
            <button type="button" onClick={() => applyCompress(Number(compressInput))}>
              {t('contextCompressApply')}
            </button>
            <button type="button" onClick={() => applyCompress(0)}>
              {t('contextCompressClear')}
            </button>
          </div>
          <div className={styles.chips}>
            {QUICK_COUNTS.map((count) => (
              <button key={count} type="button" onClick={() => applyCompress(count)}>
                {count}
              </button>
            ))}
          </div>
          <p className={styles.hint}>{t('contextCompressHint')}</p>
        </section>

        <section className={styles.compress}>
          <label className={styles.autoRow}>
            <input
              type="checkbox"
              checked={autoCompact}
              onChange={(event) => toggleAuto(event.target.checked)}
            />
            {t('contextAutoCompress')}
          </label>
          <p className={styles.hint}>{t('contextAutoCompressHint')}</p>
        </section>

        <div className={styles.actions}>
          <button type="button" onClick={() => setContextExcludedMany(session.id, allIds, false)}>
            {t('contextAllOn')}
          </button>
          <button type="button" onClick={() => setContextExcludedMany(session.id, allIds, true)}>
            {t('contextAllOff')}
          </button>
          <button type="button" onClick={() => keepRecent(5)}>
            {t('contextLast5')}
          </button>
          <button type="button" onClick={() => keepRecent(10)}>
            {t('contextLast10')}
          </button>
        </div>

        <div className={styles.list}>
          {rounds.length === 0 ? (
            <div className={styles.empty}>{t('contextEmpty')}</div>
          ) : (
            rounds.map(([user, reply], index) => {
              const on = !excluded.has(user.id)
              const compacted = Boolean(autoCompact && compactedIds.has(user.id))
              return (
                <label
                  key={user.id}
                  className={clsx(styles.row, !on && styles.off, compacted && styles.compacted)}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(event) => setContextExcluded(session.id, user.id, !event.target.checked)}
                  />
                  <span className={styles.index}>{index + 1}</span>
                  <span className={styles.body}>
                    <span className={styles.user}>
                      {preview(user.content, user.files.length ? t('contextAttachmentOnly') : '…')}
                    </span>
                    <span className={styles.reply}>{preview(getReplyText(reply), '…')}</span>
                  </span>
                  {compacted ? <span className={styles.compactTag}>{t('contextCompactedTag')}</span> : null}
                  <span className={styles.tokens}>
                    {estimateTokens(user.content) + estimateTokens(getReplyText(reply))}
                  </span>
                </label>
              )
            })
          )}
        </div>

        <footer className={styles.note}>{t('contextHint')}</footer>
      </aside>
      {confirmingAuto ? (
        <Modal
          title={t('contextAutoConfirmTitle')}
          onClose={() => setConfirmingAuto(false)}
          footer={
            <>
              <Button variant="outlined" size="m" onClick={() => setConfirmingAuto(false)}>
                {t('cancel')}
              </Button>
              <Button
                size="m"
                onClick={() => {
                  setAutoCompact(true)
                  setConfirmingAuto(false)
                }}
              >
                {t('contextAutoConfirmOk')}
              </Button>
            </>
          }
        >
          {t('contextAutoConfirmDescription')}
        </Modal>
      ) : null}
    </>
  )
}
