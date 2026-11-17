import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useChatStore, resummarizeSession, setSummaryOverride } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { useMemory } from '../../services/memory.js'
import styles from './MemoryPanel.module.css'

type Tab = 'core' | 'summary' | 'recall' | 'usage'

/** 记忆控制台：核心锚点、摘要、召回、用量；人格不再注入请求。 */
export const MemoryPanel = ({ session, onClose }: { session: Session; onClose: () => void }) => {
  const t = useTranslate()
  const [tab, setTab] = useState<Tab>('core')
  const coreAnchors = useMemory((state) => state.coreAnchors)
  const setCoreAnchors = useMemory((state) => state.setCoreAnchors)
  const reset = useMemory((state) => state.reset)
  const debug = useChatStore((state) => state.contextDebug[session.id])

  const [draftAnchors, setDraftAnchors] = useState(coreAnchors.join('\n'))
  const [summaryDraft, setSummaryDraft] = useState(session.summaryOverride ?? '')

  const saveAnchors = () =>
    setCoreAnchors(
      draftAnchors
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    )
  const restore = () => {
    reset()
    setDraftAnchors(useMemory.getState().coreAnchors.join('\n'))
  }

  const usage = session.messages.reduce(
    (acc, message) => {
      if (message.role !== 'assistant' || !message.usage) {
        return acc
      }
      acc.input += message.usage.input_tokens
      acc.output += message.usage.output_tokens
      acc.cache +=
        message.usage.cache_read_input_tokens + message.usage.cache_creation_input_tokens
      return acc
    },
    { input: 0, output: 0, cache: 0 }
  )

  const tabs: { key: Tab; label: string }[] = [
    { key: 'core', label: t('memoryTabCore') },
    { key: 'summary', label: t('memoryTabSummary') },
    { key: 'recall', label: t('memoryTabRecall') },
    { key: 'usage', label: t('memoryTabUsage') },
  ]

  return (
    <>
      <div className={styles.mask} onClick={onClose} />
      <aside className={styles.panel} role="dialog" aria-label={t('memoryTitle')}>
        <header className={styles.head}>
          <div className={styles.headText}>
            <div className={styles.title}>{t('memoryTitle')}</div>
            <div className={styles.sub}>
              {debug
                ? `${t('contextCoreCount', { count: debug.coreRounds })} · ${t('contextTokens', { count: debug.tokens })}`
                : t('memoryNoContext')}
            </div>
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

        <div className={styles.tabs}>
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              className={tab === item.key ? styles.active : undefined}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className={styles.body}>
          {tab === 'core' ? (
            <div className={styles.field}>
              <p className={styles.hint}>{t('memoryCoreHint')}</p>
              <textarea
                className={styles.textarea}
                value={draftAnchors}
                onChange={(event) => setDraftAnchors(event.target.value)}
                spellCheck={false}
              />
              <div className={styles.actions}>
                <button type="button" className={styles.primary} onClick={saveAnchors}>
                  {t('memorySave')}
                </button>
                <button type="button" className={styles.ghost} onClick={restore}>
                  {t('memoryReset')}
                </button>
              </div>
            </div>
          ) : null}

          {tab === 'summary' ? (
            <div className={styles.field}>
              <p className={styles.hint}>{t('memorySummaryHint')}</p>
              {session.summaryBlocks?.length ? (
                <div className={styles.recallList}>
                  {session.summaryBlocks.map((block) => (
                    <pre key={block.id} className={styles.pre}>
                      {block.text}
                    </pre>
                  ))}
                </div>
              ) : (
                <p className={styles.empty}>{t('memoryNoBlocks')}</p>
              )}
              <textarea
                className={styles.textarea}
                value={summaryDraft}
                onChange={(event) => setSummaryDraft(event.target.value)}
                placeholder={t('memorySummaryOverrideHint')}
                spellCheck={false}
              />
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => {
                    resummarizeSession(session.id)
                    setSummaryDraft('')
                  }}
                >
                  {t('memoryResummarize')}
                </button>
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => setSummaryOverride(session.id, summaryDraft)}
                >
                  {t('memorySaveOverride')}
                </button>
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => {
                    setSummaryOverride(session.id, '')
                    setSummaryDraft('')
                  }}
                >
                  {t('memoryClearOverride')}
                </button>
              </div>
            </div>
          ) : null}

          {tab === 'recall' ? (
            <div className={styles.field}>
              <p className={styles.hint}>{t('memoryRecallHint')}</p>
              {debug?.recall.length ? (
                <div className={styles.recallList}>
                  {debug.recall.map((hit) => (
                    <div key={hit.id} className={styles.recallRow}>
                      <span className={styles.score}>{hit.score.toFixed(2)}</span>
                      <span className={styles.recallText}>{hit.text}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.empty}>{t('memoryNoRecall')}</p>
              )}
            </div>
          ) : null}

          {tab === 'usage' ? (
            <div className={styles.usage}>
              <div className={styles.usageItem}>
                <span>{t('memoryUsageInput')}</span>
                <strong>{usage.input.toLocaleString()}</strong>
              </div>
              <div className={styles.usageItem}>
                <span>{t('memoryUsageOutput')}</span>
                <strong>{usage.output.toLocaleString()}</strong>
              </div>
              <div className={styles.usageItem}>
                <span>{t('memoryUsageCache')}</span>
                <strong>{usage.cache.toLocaleString()}</strong>
              </div>
            </div>
          ) : null}
        </div>
      </aside>
    </>
  )
}
