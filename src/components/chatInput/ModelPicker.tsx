import clsx from 'clsx'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { CHAT_MODELS } from '../../services/api/types.js'
import { setModel, setThinking, useSettings } from '../../services/settings.js'
import { useExitGhost } from '../../utils/exitGhost.js'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import { IconCheckOutline16, IconChevronDownOutline14 } from '../base/icons.js'
import styles from './ModelPicker.module.css'

const LABELS = {
  'claude-opus-5-5': ['modelOpus', 'modelOpusDesc'],
  'claude-sonnet-5-5': ['modelSonnet', 'modelSonnetDesc'],
  'claude-haiku-5-5': ['modelHaiku', 'modelHaikuDesc'],
  'claude-fable-5-2': ['modelFable', 'modelFableDesc'],
} as const

/**
 * 输入栏里的模型选择：点开向上弹出，选模型；底部一行开关控制是否显示思考过程。
 * Claude 的模型总会按需思考（Opus 5.5 关不掉），所以这里不做「深度思考」开关，只决定看不看。
 */
export const ModelPicker = ({ className, labelClassName }: { className: string; labelClassName: string }) => {
  const t = useTranslate()
  const model = useSettings((state) => state.model)
  const showThinking = useSettings((state) => state.thinking)
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(open, {
    side: 'top',
    align: 'start',
    offset: 6,
  })
  useDismiss(open, [anchorRef, floatingRef], close)
  useExitGhost(floatingRef, open)

  return (
    <>
      <span ref={anchorRef} style={{ display: 'inline-flex' }}>
        <button
          type="button"
          className={clsx(className, open && styles.open)}
          aria-label={t('settingsModel')}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className={labelClassName} style={{ display: 'inline' }}>
            {t(LABELS[model][0])}
          </span>
          <span className={styles.chevron}>
            <IconChevronDownOutline14 />
          </span>
        </button>
      </span>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.panel}
              data-motion="drop"
              style={position ?? undefined}
              role="menu"
            >
              {CHAT_MODELS.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={value === model}
                  className={styles.model}
                  onClick={() => {
                    setModel(value)
                    close()
                  }}
                >
                  <span className={styles.text}>
                    <span className={styles.name}>{t(LABELS[value][0])}</span>
                    <span className={styles.desc}>{t(LABELS[value][1])}</span>
                  </span>
                  <span className={styles.check}>{value === model ? <IconCheckOutline16 /> : null}</span>
                </button>
              ))}
              <div className={styles.divider} />
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={showThinking}
                className={styles.switchRow}
                onClick={() => setThinking(!showThinking)}
              >
                <span className={styles.text}>
                  <span>{t('showThinking')}</span>
                  <span className={styles.desc}>{t('showThinkingDesc')}</span>
                </span>
                <span className={clsx(styles.switch, showThinking && styles.switchOn)} />
              </button>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
