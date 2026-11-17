import { getContextRounds, getReplyText } from './reply.js'
import type { AssistantMessage, Message, UserMessage } from './types.js'

export type RecallHit = {
  id: string
  text: string
  score: number
  user: UserMessage
  reply: AssistantMessage
}

/** 中文按二元组、英文按词切；足够本地 BM25 用，不引入分词依赖。 */
const tokenize = (text: string) => {
  const source = (text || '').toLowerCase()
  const words = source.match(/[a-z0-9_.]+/g) ?? []
  const cjk = source.replace(/[^\u3400-\u9fff]/g, '')
  const grams: string[] = []
  for (let i = 0; i < cjk.length - 1; i += 1) {
    grams.push(cjk.slice(i, i + 2))
  }
  if (cjk.length === 1) {
    grams.push(cjk)
  }
  return [...words, ...grams]
}

const estimateTokens = (text: string) => Math.ceil((text || '').length / 2)

/**
 * 本地 BM25 召回：只看当前会话里、尚未进入核心/近期窗口的旧轮次。
 * 不调用 API，不产生费用；命中结果交给 buildContext 拼进 system。
 */
export const recallRounds = (
  history: Message[],
  query: string,
  exclude: ReadonlySet<string>,
  limit = 4,
  maxTokens = 1000
): RecallHit[] => {
  const rounds = getContextRounds(history).filter(([user]) => !exclude.has(user.id))
  const queryTokens = [...new Set(tokenize(query))]
  if (!rounds.length || !queryTokens.length) {
    return []
  }

  const docs = rounds.map(([user, reply]) => tokenize(`${user.content}\n${getReplyText(reply)}`))
  const df = new Map<string, number>()
  for (const tokens of docs) {
    for (const token of new Set(tokens)) {
      df.set(token, (df.get(token) ?? 0) + 1)
    }
  }
  const avgLength = docs.reduce((sum, tokens) => sum + tokens.length, 0) / docs.length || 1
  const k1 = 1.2
  const b = 0.75
  const total = docs.length

  const scored = docs
    .map((tokens, index) => {
      const tf = new Map<string, number>()
      for (const token of tokens) {
        tf.set(token, (tf.get(token) ?? 0) + 1)
      }
      let score = 0
      for (const token of queryTokens) {
        const frequency = tf.get(token) ?? 0
        if (!frequency) {
          continue
        }
        const docFrequency = df.get(token) ?? 0
        const idf = Math.log(1 + (total - docFrequency + 0.5) / (docFrequency + 0.5))
        score +=
          (idf * frequency * (k1 + 1)) /
          (frequency + k1 * (1 - b + (b * tokens.length) / avgLength))
      }
      return { index, score }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)

  const hits: RecallHit[] = []
  let used = 0
  for (const { index, score } of scored) {
    const [user, reply] = rounds[index]
    const text = `Gardenia: ${user.content || `[${user.files.length} 个附件]`}\n白: ${getReplyText(reply)}`
    const tokens = estimateTokens(text)
    if (used + tokens > maxTokens) {
      continue
    }
    hits.push({ id: user.id, text, score: Number(score.toFixed(4)), user, reply })
    used += tokens
    if (hits.length >= limit) {
      break
    }
  }
  return hits
}
