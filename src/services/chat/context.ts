import type { MessageParam } from '../api/types.js'
import { useMemory } from '../memory.js'
import { recallRounds, type RecallHit } from './recall.js'
import { getContextRounds, getReplyText, toRequestMessages } from './reply.js'
import type { AssistantMessage, Message, Session, UserMessage } from './types.js'

/**
 * 默认行为尽量贴近官方 demo：官方 system、原样全量历史。
 * 只有历史估算超过预算时才压缩：核心锚点轮次 + 最近轮次 + 摘要 + BM25 召回。
 */
export const CONTEXT_BUDGET = 64000
export const RECENT_ROUNDS = 12
export const CORE_ROUNDS_MAX = 24
export const SUMMARY_TOKENS = 640
export const RECALL_TOKENS = 1000

export const estimateTokens = (text: string) => Math.ceil((text || '').length / 2)

export const estimateHistoryTokens = (history: Message[]) =>
  getContextRounds(history).reduce(
    (sum, [user, reply]) => sum + roundTokens(user, reply),
    0
  )

export const coreHits = (text: string) =>
  useMemory.getState().coreAnchors.filter((anchor) => anchor && text.includes(anchor))

const clip = (text: string, max: number) => {
  const line = (text || '').replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max)}…` : line
}

const roundText = (user: UserMessage, reply: AssistantMessage) =>
  `${user.content}\n${getReplyText(reply)}`

export const isCoreRound = (user: UserMessage, reply: AssistantMessage) =>
  coreHits(roundText(user, reply)).length > 0

const roundTokens = (user: UserMessage, reply: AssistantMessage) =>
  estimateTokens(user.content) +
  estimateTokens(getReplyText(reply)) +
  user.files.length * 16 +
  8

const summaryLine = ([user, reply]: [UserMessage, AssistantMessage]) => {
  const body = getReplyText(reply)
  const anchored = isCoreRound(user, reply)
  const ask = clip(user.content || (user.files.length ? `[${user.files.length} 个附件]` : ''), anchored ? 160 : 64)
  const answer = clip(body, anchored ? 160 : 64)
  return `- ${ask} → ${answer}`
}

const anchorSnippet = (text: string) => {
  const anchor = coreHits(text)[0]
  if (!anchor) {
    return ''
  }
  const at = text.indexOf(anchor)
  return clip(text.slice(Math.max(0, at - 40), at + 120), 160)
}

export const buildSummary = (rounds: [UserMessage, AssistantMessage][]) => {
  const lines: string[] = []
  let total = 0
  for (const round of rounds) {
    const line = summaryLine(round)
    const tokens = estimateTokens(line)
    if (total + tokens > SUMMARY_TOKENS - 40) {
      break
    }
    lines.push(line)
    total += tokens
  }
  return lines.join('\n')
}

export type BuiltContext = {
  messages: MessageParam[]
  /** 追加到 system prompt 的记忆说明（人格 + 核心锚点 + 摘要 + 召回）。 */
  system: string
  summary: string
  recall: RecallHit[]
  coreRounds: number
  recentRounds: number
  summarizedRounds: number
  droppedRounds: number
  tokens: number
}

/**
 * 组装一次请求的上下文。
 * 过滤顺序：核心锚点轮次 → 最近轮次 → 更早轮次压摘要 → 旧事 BM25 召回。
 * 超预算时只从最近的日常轮次尾部丢弃，核心锚点不动。
 */
export const buildContext = (
  history: Message[],
  question: UserMessage,
  prefix: AssistantMessage | undefined,
  thinking: boolean,
  latestReminder: string | undefined,
  session?: Session
): BuiltContext => {
  const excluded = new Set(session?.contextExcluded ?? [])
  const all = getContextRounds(history)
  const questionTokens = estimateTokens(question.content) + question.files.length * 16

  // 正常长度：完全按官方 demo 的语义走，不注入人格、锚点表、摘要或召回。
  const fullTokens =
    all.reduce((sum, [user, reply]) => sum + roundTokens(user, reply), 0) +
    questionTokens +
    16
  if (fullTokens <= CONTEXT_BUDGET) {
    return {
      messages: toRequestMessages(
        history,
        question,
        prefix,
        thinking,
        latestReminder,
        excluded
      ),
      system: '',
      summary: '',
      recall: [],
      coreRounds: 0,
      recentRounds: all.length,
      summarizedRounds: 0,
      droppedRounds: 0,
      tokens: fullTokens,
    }
  }

  const allCore = all.filter(([user, reply]) => isCoreRound(user, reply))
  const half = Math.floor(CORE_ROUNDS_MAX / 2)
  const core =
    allCore.length > CORE_ROUNDS_MAX
      ? [...allCore.slice(0, half), ...allCore.slice(-half)]
      : allCore
  const omittedCore =
    allCore.length > CORE_ROUNDS_MAX
      ? allCore.slice(half, allCore.length - half)
      : []
  const coreSnippets = [
    ...new Set(
      omittedCore
        .map(([user, reply]) => anchorSnippet(roundText(user, reply)))
        .filter(Boolean)
    ),
  ].slice(0, 12)
  const daily = all.filter(
    ([user, reply]) => !isCoreRound(user, reply) && !excluded.has(user.id)
  )
  const recent = daily.slice(-RECENT_ROUNDS)
  const older = daily.slice(0, -RECENT_ROUNDS)
  const blocks = session?.summaryBlocks ?? []
  const covered = new Set(blocks.flatMap((block) => block.msgIds))
  const uncoveredOlder = older.filter(([user]) => !covered.has(user.id))

  const coreTokens = core.reduce((sum, [user, reply]) => sum + roundTokens(user, reply), 0)
  const chosenRecent = recent.slice()
  const dropped: [UserMessage, AssistantMessage][] = []
  let recall: RecallHit[] = []
  const recallTokens = () => recall.reduce((sum, hit) => sum + estimateTokens(hit.text), 0)
  const totalTokens = () =>
    coreTokens +
    chosenRecent.reduce((sum, [user, reply]) => sum + roundTokens(user, reply), 0) +
    recallTokens() +
    questionTokens +
    16

  while (chosenRecent.length && totalTokens() > CONTEXT_BUDGET) {
    dropped.unshift(chosenRecent[0])
    chosenRecent.shift()
  }

  const selected = new Set([...core, ...chosenRecent].map(([user]) => user.id))
  for (const id of excluded) {
    selected.add(id)
  }
  const previousUser = [...history].reverse().find((message) => message.role === 'user')
  recall = recallRounds(
    history,
    `${question.content}\n${previousUser?.role === 'user' ? previousUser.content : ''}`,
    selected,
    4,
    RECALL_TOKENS
  )
  while (chosenRecent.length && totalTokens() > CONTEXT_BUDGET) {
    dropped.unshift(chosenRecent[0])
    chosenRecent.shift()
  }
  while (recall.length && totalTokens() > CONTEXT_BUDGET) {
    recall.pop()
  }

  const autoSummary = [
    ...blocks.map((block) => block.text),
    buildSummary(uncoveredOlder),
    buildSummary(dropped),
  ]
    .filter(Boolean)
    .join('\n')
  const summary = session?.summaryOverride?.trim() || autoSummary
  const summarizedRounds =
    blocks.reduce((sum, block) => sum + block.msgIds.length, 0) +
    uncoveredOlder.length +
    dropped.length

  const systemParts: string[] = []
  if (coreSnippets.length) {
    systemParts.push(
      `【核心锚点原文】\n${coreSnippets.map((line) => `- ${line}`).join('\n')}`
    )
  }
  if (summary) {
    systemParts.push(`【早期对话摘要】\n${summary}`)
  }
  if (recall.length) {
    systemParts.push(
      `【相关过往】\n${recall
        .map(
          (hit) =>
            `- [${new Date(hit.user.createdAt).toLocaleDateString('zh-CN')}] ${hit.text}`
        )
        .join('\n')}`
    )
  }

  const chosen = [...core, ...chosenRecent].sort(
    ([a], [b]) => a.createdAt - b.createdAt
  )
  const filteredHistory: Message[] = []
  for (const [user, reply] of chosen) {
    filteredHistory.push(user, reply)
  }

  const messages = toRequestMessages(
    filteredHistory,
    question,
    prefix,
    thinking,
    latestReminder
  )

  return {
    messages,
    system: systemParts.join('\n\n'),
    summary,
    recall,
    coreRounds: allCore.length,
    recentRounds: chosenRecent.length,
    summarizedRounds,
    droppedRounds: dropped.length,
    tokens: totalTokens(),
  }
}

export type BuiltRequest = {
  messages: MessageParam[]
  /** 追加到官方 system 之后的内容；空字符串表示纯官方。 */
  system: string
}

/**
 * 组装一次请求。默认纯官方：原样全量历史，不注入任何东西。
 * - 显式 contextCompress：把最早 N 轮压成摘要放进 system，其余原样发送；
 * - 手动排除始终生效。
 */
export const buildRequestMessages = (
  history: Message[],
  question: UserMessage,
  prefix: AssistantMessage | undefined,
  thinking: boolean,
  latestReminder: string | undefined,
  session?: Session
): BuiltRequest => {
  const excluded = new Set(session?.contextExcluded ?? [])
  const compress = Math.max(0, session?.contextCompress ?? 0)
  const rounds = getContextRounds(history).filter(([user]) => !excluded.has(user.id))

  // 旧版的「按预算自动压缩」已并入全局的自动压缩（设置里同一个开关），这里不再处理。

  if (!compress) {
    return {
      messages: toRequestMessages(
        history,
        question,
        prefix,
        thinking,
        latestReminder,
        excluded
      ),
      system: '',
    }
  }
  const toCompress = rounds.slice(0, compress)
  const keep = rounds.slice(compress)
  const keepHistory: Message[] = []
  for (const [user, reply] of keep) {
    keepHistory.push(user, reply)
  }
  const summary = buildSummary(toCompress)
  return {
    messages: toRequestMessages(keepHistory, question, prefix, thinking, latestReminder),
    system: summary ? `【早期对话摘要】\n${summary}` : '',
  }
}
