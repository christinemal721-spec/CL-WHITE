import clsx from 'clsx'
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { copyText } from '../../utils/clipboard.js'
import { haptic } from '../../utils/haptic.js'
import { Signature } from '../base/Signature.js'
import { showToast } from '../base/toastState.js'
import { setOrigin } from '../historySearch/historySearchState.js'
import pageStyles from '../historySearch/HistorySearchPage.module.css'
import { useEdgeSwipeBack } from '../historySearch/useEdgeSwipeBack.js'
import { closeAbout, registerAboutPage, useAbout } from './aboutState.js'
import styles from './AboutPage.module.css'

export const AUTHOR_EMAIL = 'christinemal721@gmail.com'

/** 「【…】」里的字加粗（括号保留），和首次使用说明一致 */
const emphasize = (text: string): ReactNode[] =>
  text.split(/(【[^】]*】)/).map((part, index) =>
    part.startsWith('【') ? <strong key={index}>{part}</strong> : part
  )

/**
 * 联系作者：版本说明 + 反馈邮箱。
 * 展开、返回键 / Esc 关闭、左边缘右滑返回，都和搜索页一致（共用同一套页面样式）。
 */
export const AboutPage = () => {
  const t = useTranslate()
  const open = useAbout((state) => state.open)
  const origin = useAbout((state) => state.origin)
  const closing = useAbout((state) => state.closing)
  const pageRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    registerAboutPage(pageRef.current)
    return () => registerAboutPage(null)
  }, [])

  useLayoutEffect(() => {
    if (origin && pageRef.current) {
      setOrigin(pageRef.current, origin)
    }
  }, [origin])

  useEffect(() => {
    if (!open) {
      return
    }
    bodyRef.current?.scrollTo({ top: 0 })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAbout()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEdgeSwipeBack(pageRef, open, () => {}, () => closeAbout('instant'))

  const copyEmail = async () => {
    haptic()
    showToast(t(await copyText(AUTHOR_EMAIL) ? 'aboutEmailCopied' : 'aboutEmailCopyFailed'))
  }

  const excluded = t('aboutExcludedList').split('、')

  return createPortal(
    <div
      ref={pageRef}
      className={clsx(
        pageStyles.page,
        open && pageStyles.open,
        !open && closing === 'instant' && pageStyles.instant
      )}
      role="dialog"
      aria-modal={open}
      aria-hidden={!open}
      aria-label={t('aboutTitle')}
    >
      <div className={pageStyles.inner}>
        <header className={clsx(pageStyles.header, styles.header)}>
          <button
            type="button"
            className={clsx(pageStyles.back, styles.back)}
            data-ripple
            aria-label={t('historySearchBack')}
            tabIndex={open ? 0 : -1}
            onClick={() => closeAbout()}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path
                d="M11 3.5 5.5 9l5.5 5.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <h2 className={styles.title}>{t('aboutTitle')}</h2>
        </header>

        <div ref={bodyRef} className={styles.body}>
          <div className={styles.hero}>
            <Signature width={132} motion="still" alt={t('appName')} />
            <div className={styles.version}>DS WHITE · V1</div>
          </div>

          <section className={clsx(styles.card, 'white-glass')}>
            <h3 className={styles.cardTitle}>{t('aboutVersionTitle')}</h3>
            <p className={styles.text}>{emphasize(t('aboutPurpose'))}</p>
            <p className={styles.text}>{emphasize(t('aboutNoMore'))}</p>
            <div className={styles.chips} aria-label={t('aboutExcludedLabel')}>
              {excluded.map((item) => (
                <span key={item} className={styles.chip}>
                  {item}
                </span>
              ))}
              <span className={clsx(styles.chip, styles.chipMore)}>{t('aboutExcludedMore')}</span>
            </div>
          </section>

          <section className={clsx(styles.card, 'white-glass')}>
            <h3 className={styles.cardTitle}>{t('aboutFeedbackTitle')}</h3>
            <p className={styles.text}>{t('aboutFeedback')}</p>
            <div className={styles.mail}>
              <a
                className={styles.mailLink}
                href={`mailto:${AUTHOR_EMAIL}?subject=${encodeURIComponent('DS WHITE 反馈')}`}
                tabIndex={open ? 0 : -1}
              >
                <span className={styles.mailLabel}>{t('aboutEmailLabel')}</span>
                <span className={styles.mailAddress}>{AUTHOR_EMAIL}</span>
              </a>
              <button
                type="button"
                className={styles.copy}
                tabIndex={open ? 0 : -1}
                onClick={copyEmail}
              >
                {t('aboutEmailCopy')}
              </button>
            </div>
          </section>

          <p className={styles.footnote}>{t('introMotto')}</p>
        </div>
      </div>
    </div>,
    document.body
  )
}
