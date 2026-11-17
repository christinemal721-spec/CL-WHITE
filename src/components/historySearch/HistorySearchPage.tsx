import clsx from 'clsx'
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import {
  searchHistory,
  type HistorySearchOutput,
  type HistorySearchResult,
} from '../../services/chat/search.js'
import { openSessionAt } from '../../services/chat/store.js'
import { formatDate } from '../../utils/format.js'
import { IconSearchOutline16 } from '../base/icons.js'
import { closeMobileSider } from '../sider/mobileSiderState.js'
import {
  closeHistorySearch,
  registerSearchPage,
  setOrigin,
  useHistorySearch,
} from './historySearchState.js'
import styles from './HistorySearchPage.module.css'
import { useEdgeSwipeBack } from './useEdgeSwipeBack.js'

/** 把命中的关键词标出来 */
const Highlight = ({ text, query }: { text: string; query: string }) => {
  const q = query.trim()
  if (!q) {
    return <>{text}</>
  }
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  const parts: { text: string; hit: boolean }[] = []
  let at = 0
  for (let index = lower.indexOf(needle); index >= 0; index = lower.indexOf(needle, at)) {
    if (index > at) {
      parts.push({ text: text.slice(at, index), hit: false })
    }
    parts.push({ text: text.slice(index, index + q.length), hit: true })
    at = index + q.length
  }
  parts.push({ text: text.slice(at), hit: false })
  return (
    <>
      {parts.map((part, index) =>
        part.hit ? (
          <mark key={index} className={styles.mark}>
            {part.text}
          </mark>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        )
      )}
    </>
  )
}

/**
 * 历史对话搜索页：常驻挂载（隐藏），点边栏「搜索」时从按钮的位置展开成整页，
 * 关闭时缩回按钮；选中结果后原地淡出并打开那段对话。
 */
/** 每批显示的结果数 */
const PAGE = 40

export const HistorySearchPage = () => {
  const t = useTranslate()
  const open = useHistorySearch((state) => state.open)
  const origin = useHistorySearch((state) => state.origin)
  const closing = useHistorySearch((state) => state.closing)
  const pageRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<HistorySearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [truncated, setTruncated] = useState(false)
  /** 结果是边搜边出的：还没搜完 */
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  // 结果一次只渲染一批，滚到底或点「显示更多」再接着显示
  const [shown, setShown] = useState(PAGE)
  // 每次搜索换一批 key，让结果按顺序依次浮现
  const [batch, setBatch] = useState(0)

  useLayoutEffect(() => {
    registerSearchPage(pageRef.current, inputRef.current)
    return () => registerSearchPage(null, null)
  }, [])

  // 窗口尺寸变化后，缩回的终点仍对准按钮
  useLayoutEffect(() => {
    if (origin && pageRef.current) {
      setOrigin(pageRef.current, origin)
    }
  }, [origin])

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      setSearching(false)
      return
    }
    let live = true
    let first = true
    // 换了关键词就先清掉上一次的结果，不让旧结果冒充新结果
    setResults([])
    setTruncated(false)
    setPending(true)
    setFailed(false)
    setSearching(true)
    const show = (found: HistorySearchOutput) => {
      if (!live) {
        return
      }
      setResults(found.results)
      setTruncated(found.truncated)
      setPending(found.pending)
      if (first) {
        // 只在这次搜索第一次出结果时重播浮现动画，后续追加不闪
        first = false
        setShown(PAGE)
        setBatch((value) => value + 1)
      }
    }
    const timer = setTimeout(() => {
      searchHistory(q, () => !live, show)
        .then((found) => {
          if (found) {
            show(found)
          }
        })
        .catch(() => {
          if (live) {
            setFailed(true)
          }
        })
        .finally(() => {
          if (live) {
            setSearching(false)
          }
        })
    }, 220)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query])

  // 关闭动画结束后清空，下次打开是干净的
  useEffect(() => {
    if (open) {
      return
    }
    const timer = setTimeout(() => {
      setQuery('')
      setResults([])
      setTruncated(false)
      setShown(PAGE)
    }, 320)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeHistorySearch()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  // 空的时候搜索框停在可见区域的视觉中心（键盘弹出后是键盘上方那块的中心）
  useLayoutEffect(() => {
    const page = pageRef.current
    const header = headerRef.current
    if (!page || !header || !open) {
      return
    }
    const viewport = window.visualViewport
    const place = () => {
      const visible = viewport?.height ?? window.innerHeight
      const rect = header.getBoundingClientRect()
      const center = rect.top + rect.height / 2
      page.style.setProperty('--dock-y', `${Math.max(0, visible * 0.42 - center)}px`)
    }
    place()
    viewport?.addEventListener('resize', place)
    window.addEventListener('resize', place)
    return () => {
      viewport?.removeEventListener('resize', place)
      window.removeEventListener('resize', place)
    }
  }, [open])

  // 从左边缘右滑返回：页面跟手，松手过三分之一或快速一甩就关闭，否则弹回
  useEdgeSwipeBack(
    pageRef,
    open,
    () => inputRef.current?.blur(),
    () => closeHistorySearch('instant')
  )

  const q = query.trim()

  return createPortal(
    <div
      ref={pageRef}
      className={clsx(
        styles.page,
        open && styles.open,
        !open && closing === 'fade' && styles.fade,
        !open && closing === 'instant' && styles.instant
      )}
      role="dialog"
      aria-modal={open}
      aria-hidden={!open}
      aria-label={t('historySearchTitle')}
    >
      <div className={styles.inner}>
        <header ref={headerRef} className={styles.header}>
          <button
            type="button"
            className={styles.back}
            data-ripple
            aria-label={t('historySearchBack')}
            onClick={() => closeHistorySearch()}
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
          <div className={clsx(styles.dock, !q && styles.idle)}>
            <label className={styles.field}>
              <span className={styles.fieldIcon}>
                <IconSearchOutline16 />
              </span>
              <input
                ref={inputRef}
                className={styles.input}
                type="search"
                enterKeyHint="search"
                placeholder={t('searchHistoryPlaceholder')}
                value={query}
                tabIndex={open ? 0 : -1}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur()
                  }
                }}
              />
              {query ? (
                <button
                  type="button"
                  className={styles.clear}
                  aria-label={t('historySearchClear')}
                  onClick={() => {
                    setQuery('')
                    inputRef.current?.focus({ preventScroll: true })
                  }}
                >
                  ×
                </button>
              ) : null}
            </label>
            <div className={styles.hint} aria-hidden={Boolean(q)}>
              {t('historySearchHintSub')}
            </div>
          </div>
        </header>

        <div
          className={styles.body}
          // 开始滑动结果时收起键盘
          onTouchStart={() => inputRef.current?.blur()}
        >
          {!q ? null : searching && results.length === 0 ? (
            <div className={styles.status}>{t('searching')}</div>
          ) : failed && results.length === 0 ? (
            <div className={styles.status}>{t('historySearchFailed')}</div>
          ) : results.length === 0 ? (
            <div className={styles.status}>{t('searchHistoryEmpty')}</div>
          ) : (
            <>
              <div className={styles.count}>
                {t(
                  searching && pending
                    ? 'historySearchCountPending'
                    : truncated
                      ? 'historySearchCountMore'
                      : 'historySearchCount',
                  { count: results.length }
                )}
              </div>
              {results.slice(0, shown).map((result, index) => (
                <button
                  key={`${batch}-${result.sessionId}-${result.messageId ?? 'title'}`}
                  type="button"
                  className={styles.result}
                  data-motion="rise"
                  style={{ animationDelay: `${Math.min(index % PAGE, 8) * 28}ms` }}
                  onClick={() => {
                    openSessionAt(result.sessionId, result.messageId)
                    closeMobileSider()
                    closeHistorySearch('fade')
                  }}
                >
                  <span className={styles.resultHead}>
                    <span className={styles.resultTitle}>
                      <Highlight text={result.title || t('untitledChat')} query={q} />
                    </span>
                    <time
                      className={styles.resultDate}
                      dateTime={formatDate(result.matchedAt) ?? undefined}
                    >
                      {formatDate(result.matchedAt)}
                    </time>
                  </span>
                  <span className={styles.resultSnippet}>
                    <Highlight text={result.snippet} query={q} />
                  </span>
                </button>
              ))}
              {shown < results.length ? (
                <button
                  type="button"
                  className={styles.more}
                  data-ripple
                  onClick={() => setShown((value) => value + PAGE)}
                >
                  {t('historySearchMore', { count: results.length - shown })}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
