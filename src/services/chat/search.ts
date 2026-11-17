import { getVisibleMessages } from './branches.js'
import * as db from './db.js'
import { getReplyText } from './reply.js'
import type { Message } from './types.js'

export type HistorySearchResult = {
  sessionId: string
  /** 命中的消息；标题命中时为空，点击只打开会话 */
  messageId: string | null
  title: string
  snippet: string
  updatedAt: number
  /** 命中内容的时间：正文命中取那条消息的发送时间，标题命中取会话的更新时间 */
  matchedAt: number
}

export type HistorySearchOutput = {
  results: HistorySearchResult[]
  /** 命中太多时只保留最新的 MAX_RESULTS 条 */
  truncated: boolean
  /** 还没搜完（边搜边显示） */
  pending: boolean
}

/** 单次搜索最多保留的命中数；界面再分批显示 */
const MAX_RESULTS = 20000
/** 每次从数据库读多少段会话 */
const BATCH = 40
/** 边搜边显示：至少隔这么久把已找到的结果交给界面一次 */
const PARTIAL_MS = 250

const messageText = (message: Message): string => {
  try {
    const text = message.role === 'user' ? message.content : getReplyText(message)
    return typeof text === 'string' ? text : ''
  } catch {
    return ''
  }
}

const makeSnippet = (text: string, lower: string, query: string, radius = 56) => {
  const index = lower.indexOf(query)
  if (index < 0) {
    return text.slice(0, 80)
  }
  const start = Math.max(0, index - radius)
  const end = Math.min(text.length, index + query.length + radius)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return prefix + text.slice(start, end).replace(/\s+/g, ' ').trim() + suffix
}

type IndexedMessage = { id: string; createdAt: number; text: string; lower: string }

/**
 * 会话正文的文本缓存（按更新时间失效）：第一次搜索要把全部会话读一遍，之后再搜就只在内存里找。
 * 只存纯文本，不存图片等附件。
 */
const cache = new Map<string, { updatedAt: number; messages: IndexedMessage[] }>()

export const clearSearchCache = () => cache.clear()

const indexSession = (messages: Message[]): IndexedMessage[] =>
  messages.map((message) => {
    const text = messageText(message)
    const lower = text.toLowerCase()
    // 纯中文没有大小写，lower 与原文是同一个字符串，不额外占内存
    return { id: message.id, createdAt: message.createdAt, text, lower: lower === text ? text : lower }
  })

/**
 * 搜索全部会话的每一条消息：每处命中都是一条结果（同一会话可以有多条），标题命中另算一条。
 * 不限会话数量，结果按命中时间从新到旧排列。从最近的会话开始搜，边搜边通过 onPartial 交出结果。
 * 某段会话读坏了就跳过，不影响其他会话。isStale 为真时放弃，返回 null。
 */
export const searchHistory = async (
  query: string,
  isStale: () => boolean = () => false,
  onPartial?: (output: HistorySearchOutput) => void
): Promise<HistorySearchOutput | null> => {
  const q = query.trim().toLowerCase()
  if (!q) {
    return { results: [], truncated: false, pending: false }
  }
  const summaries = (await db.loadSessionSummaries()).sort((a, b) => b.updatedAt - a.updatedAt)
  const results: HistorySearchResult[] = []
  let lastPartial = performance.now()

  const output = (pending: boolean): HistorySearchOutput => {
    results.sort((a, b) => b.matchedAt - a.matchedAt)
    const truncated = results.length > MAX_RESULTS
    if (truncated) {
      results.length = MAX_RESULTS
    }
    return { results: results.slice(), truncated, pending }
  }

  for (let start = 0; start < summaries.length; start += BATCH) {
    if (isStale()) {
      return null
    }
    const batch = summaries.slice(start, start + BATCH)
    const missing = batch.filter((summary) => cache.get(summary.id)?.updatedAt !== summary.updatedAt)
    if (missing.length > 0) {
      let loaded: Awaited<ReturnType<typeof db.loadSessions>> = []
      try {
        loaded = await db.loadSessions(missing.map((summary) => summary.id))
      } catch {
        // 整批读失败：逐段再试，坏的那段跳过
        loaded = await Promise.all(
          missing.map((summary) => db.loadSession(summary.id).catch(() => undefined))
        )
      }
      missing.forEach((summary, index) => {
        const session = loaded[index]
        if (!session) {
          return
        }
        try {
          // 只搜当前显示的版本路径：搜到的消息一定能在对话里定位到
          cache.set(summary.id, {
            updatedAt: summary.updatedAt,
            messages: indexSession(getVisibleMessages(session)),
          })
        } catch {
          // 数据异常的会话不参与搜索
        }
      })
      if (isStale()) {
        return null
      }
    }
    for (const summary of batch) {
      const title = summary.title || '…'
      if ((summary.title || '').toLowerCase().includes(q)) {
        results.push({
          sessionId: summary.id,
          messageId: null,
          title,
          snippet: summary.title,
          updatedAt: summary.updatedAt,
          matchedAt: summary.updatedAt,
        })
      }
      for (const message of cache.get(summary.id)?.messages ?? []) {
        if (message.lower.includes(q)) {
          results.push({
            sessionId: summary.id,
            messageId: message.id,
            title,
            snippet: makeSnippet(message.text, message.lower, q),
            updatedAt: summary.updatedAt,
            matchedAt: message.createdAt || summary.updatedAt,
          })
        }
      }
    }
    if (onPartial && performance.now() - lastPartial > PARTIAL_MS) {
      lastPartial = performance.now()
      onPartial(output(true))
    }
  }
  return output(false)
}
