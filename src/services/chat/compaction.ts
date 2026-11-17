import { streamMessage } from '../api/client.js'
import { buildSummary, estimateTokens } from './context.js'
import { getContextRounds, getReplyText } from './reply.js'
import type { AssistantMessage, Compaction, Message, Session, UserMessage } from './types.js'

/**
 * 全局自动压缩（设置里开启，默认关闭）。
 * 目标：任何一次请求的上下文都不超过模型的 1M 窗口。
 * 估算接近上限时，把最早的若干轮交给模型整理成一份摘要，只原样保留最近一段对话；
 * 摘要持久化在会话上，之后的请求直接复用，再次逼近上限时把旧摘要和新一批轮次合并重写。
 */
export const CONTEXT_WINDOW = 1_000_000
/** 给本轮回答（含思考）和系统提示留的余量 */
const OUTPUT_RESERVE = 96_000
/** 超过这条线就整理：1M − 余量 */
const DEFAULT_TRIGGER = CONTEXT_WINDOW - OUTPUT_RESERVE - 24_000
/** 整理后原样保留的最近对话量，约为窗口的三成：既留足细节，也让下次整理隔得足够远 */
const DEFAULT_KEEP = 300_000
/** 至少原样保留的最近轮数 */
const MIN_KEEP_ROUNDS = 4
/** 送去整理的原文上限，超过时按比例截短每一轮 */
const SUMMARIZE_INPUT_MAX = 760_000

const debugNumber = (key: string, fallback: number) => {
  try {
    const value = Number(localStorage.getItem(key))
    return Number.isFinite(value) && value > 0 ? value : fallback
  } catch {
    return fallback
  }
}

/** 测试用：localStorage 里可以把阈值调小，正常使用不会设置 */
export const getCompactionTrigger = () => debugNumber('white:debug-compact-trigger', DEFAULT_TRIGGER)
const getKeepTokens = () => debugNumber('white:debug-compact-keep', DEFAULT_KEEP)

type Round = [UserMessage, AssistantMessage]

const roundTokens = ([user, reply]: Round) =>
  estimateTokens(user.content) + estimateTokens(getReplyText(reply)) + user.files.length * 800 + 8

/** 摘要只在它覆盖的轮次都还在当前路径上时有效（编辑早期消息、切换版本后自动失效） */
export const validCompaction = (
  session: Session | undefined,
  history: Message[]
): Compaction | undefined => {
  const compaction = session?.compaction
  if (!compaction?.msgIds.length) {
    return undefined
  }
  const ids = new Set(history.map((message) => message.id))
  return compaction.msgIds.every((id) => ids.has(id)) ? compaction : undefined
}

/** 去掉已被摘要覆盖的轮次（提问 + 紧跟的回答） */
export const withoutCompacted = (history: Message[], compaction: Compaction | undefined) => {
  if (!compaction) {
    return history
  }
  const covered = new Set(compaction.msgIds)
  const result: Message[] = []
  for (let i = 0; i < history.length; i++) {
    const message = history[i]
    if (message.role === 'user' && covered.has(message.id)) {
      if (history[i + 1]?.role === 'assistant') {
        i++
      }
      continue
    }
    result.push(message)
  }
  return result
}

export const compactionSystem = (compaction: Compaction | undefined) =>
  compaction
    ? `【更早的对话（已整理为摘要，原文不再逐条提供）】\n${compaction.text}`
    : ''

/**
 * 估算下一次请求的上下文大小。优先用上一轮服务端返回的真实用量（含附件、思考等估不准的部分），
 * 再加上之后新增的内容；没有可用的真实用量时按字数估。
 */
export const estimateNextRequest = (
  history: Message[],
  question: UserMessage,
  session: Session | undefined,
  excluded: ReadonlySet<string>
): number => {
  const compaction = validCompaction(session, history)
  const rounds = getContextRounds(withoutCompacted(history, compaction)).filter(
    ([user]) => !excluded.has(user.id)
  )
  const questionTokens = estimateTokens(question.content) + question.files.length * 800
  const summaryTokens = compaction ? estimateTokens(compaction.text) : 0
  const estimated =
    rounds.reduce((sum, round) => sum + roundTokens(round), 0) + questionTokens + summaryTokens + 400

  const last = rounds.at(-1)?.[1]
  const usage = last?.usage
  if (usage && (!compaction || last.createdAt > compaction.createdAt)) {
    const real =
      usage.input_tokens +
      usage.cache_creation_input_tokens +
      usage.cache_read_input_tokens +
      usage.output_tokens +
      questionTokens
    return Math.max(estimated, real)
  }
  return estimated
}

/** 选出这次要并进摘要的轮次：从最早未覆盖的开始，直到剩余部分落进保留量 */
export const pickRoundsToCompact = (
  history: Message[],
  session: Session | undefined,
  excluded: ReadonlySet<string>
): Round[] => {
  const compaction = validCompaction(session, history)
  const rounds = getContextRounds(withoutCompacted(history, compaction)).filter(
    ([user]) => !excluded.has(user.id)
  )
  const keep = getKeepTokens()
  let remaining = rounds.reduce((sum, round) => sum + roundTokens(round), 0)
  const picked: Round[] = []
  for (const round of rounds.slice(0, Math.max(0, rounds.length - MIN_KEEP_ROUNDS))) {
    if (remaining <= keep) {
      break
    }
    picked.push(round)
    remaining -= roundTokens(round)
  }
  return picked
}

const SUMMARIZER_SYSTEM = `你是对话记忆整理员。下面是用户与 AI 角色「WHITE」的一段长期对话的早期部分，之后的对话会接着这份摘要继续。
请把它整理成一份供 WHITE 继续对话时参考的记忆摘要，要求：
- 用中文，第三人称客观记录，不评价、不加入原文没有的内容；
- 按主题分节（例如：用户的身份与近况、偏好与习惯、重要的人和关系、约定与承诺、进行中的事、重要时刻与情绪、双方的称呼和说话方式）；
- 保留具体的名字、数字、日期、原话里的关键措辞，宁可多留细节也不要泛化；
- 已经过时或被后来推翻的信息，写明最新的结论；
- 只输出摘要正文，不要开场白。`

const fmtDate = (time: number) => new Date(time).toLocaleDateString('zh-CN')

const transcript = (rounds: Round[]) => {
  const total = rounds.reduce((sum, round) => sum + roundTokens(round), 0)
  // 超出整理请求的承受量时，按比例截短每条（每 token 约 2 字）
  const ratio = total > SUMMARIZE_INPUT_MAX ? SUMMARIZE_INPUT_MAX / total : 1
  const clip = (text: string) => {
    const max = Math.max(200, Math.floor(text.length * ratio))
    return text.length > max ? `${text.slice(0, max)}…` : text
  }
  return rounds
    .map(([user, reply]) => {
      const files = user.files.length ? `（附件：${user.files.map((f) => f.name).join('、')}）` : ''
      return `[${fmtDate(user.createdAt)}] 用户：${clip(user.content)}${files}\nWHITE：${clip(getReplyText(reply))}`
    })
    .join('\n\n')
}

/**
 * 调用模型整理摘要；失败时退回本地截取摘要，保证请求仍然落在窗口内。
 * 返回新的 Compaction（覆盖旧摘要的全部轮次 + 这次新并入的轮次）。
 */
export const summarizeRounds = async (
  apiKey: string,
  previous: Compaction | undefined,
  rounds: Round[],
  signal: AbortSignal
): Promise<Compaction> => {
  const msgIds = [...(previous?.msgIds ?? []), ...rounds.map(([user]) => user.id)]
  const coveredTokens =
    (previous?.coveredTokens ?? 0) + rounds.reduce((sum, round) => sum + roundTokens(round), 0)
  const prompt = [
    previous ? `【之前已经整理好的更早部分的摘要】\n${previous.text}\n` : '',
    `【需要整理${previous ? '并与上面的摘要合并' : ''}的对话】\n${transcript(rounds)}`,
    `\n请输出${previous ? '合并后的完整' : ''}记忆摘要。`,
  ].join('\n')
  try {
    let text = ''
    const events = streamMessage(
      apiKey,
      {
        model: 'claude-haiku-5-5',
        system: SUMMARIZER_SYSTEM,
        messages: [{ role: 'user', content: prompt }],
        thinking: { type: 'disabled' },
        tools: [],
        safety_check: { level: 'high' },
      },
      signal
    )
    for await (const event of events) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text
      }
    }
    text = text.trim()
    if (!text) {
      throw new Error('empty summary')
    }
    return { text, msgIds, coveredTokens, createdAt: Date.now() }
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    const local = [previous?.text ?? '', buildSummary(rounds)].filter(Boolean).join('\n')
    return { text: local, msgIds, coveredTokens, createdAt: Date.now(), fallback: true }
  }
}
