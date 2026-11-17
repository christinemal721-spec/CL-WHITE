import type { CreateMessageRequest, MessageParam } from './types.js'

/**
 * Claude Messages API 适配层。
 *
 * 应用其余部分沿用原来的 Anthropic 兼容格式（和 DeepSeek 的扩展字段），
 * 这里在发请求前把请求体换成 Claude 接受的写法，收到流式事件后再换回应用认识的形状：
 * - latest_reminder 角色并进下一条 user 消息；
 * - 历史里的思考、联网调用不回传，只保留正文（Claude 允许省略历史轮次的思考）；
 * - 续写（末尾是 assistant）改成追加一条「从断点继续」的 user 消息，新模型不支持 assistant 预填；
 * - 显示思考过程开 → adaptive + summarized；关 → 用默认（不返回思考内容），并把返回的空思考块丢掉；
 * - 联网搜索换成 web_search 服务端工具，结果补齐界面需要的字段。
 */

/** 单次回复（含思考）的输出上限 */
export const MAX_TOKENS = 32000
/** 每轮最多搜索几次 */
const MAX_SEARCHES = 5

/** 续写时追加的提示：模型接着上一条回答的末尾往下写 */
const CONTINUE_PROMPT =
  '（上一条回答在这里中断了。请从中断处直接接着写，不要重复已经写过的内容，也不要加任何开场白。）'

type UserContent = Extract<MessageParam, { role: 'user' }>['content']
type ClaudeMessage = { role: 'user' | 'assistant'; content: unknown[] }

const asBlocks = (content: UserContent): unknown[] =>
  typeof content === 'string' ? [{ type: 'text', text: content }] : [...content]

const toClaudeMessages = (messages: MessageParam[]): ClaudeMessage[] => {
  const result: ClaudeMessage[] = []
  let reminder: string | null = null
  for (const message of messages) {
    if (message.role === 'latest_reminder') {
      reminder = message.content
      continue
    }
    if (message.role === 'user') {
      const blocks = asBlocks(message.content).filter(
        (block) => !(isRecord(block) && block.type === 'text' && !String(block.text).trim())
      )
      if (reminder) {
        blocks.unshift({ type: 'text', text: `<context>\n${reminder}\n</context>` })
        reminder = null
      }
      const last = result.at(-1)
      if (last?.role === 'user') {
        last.content.push(...blocks)
      } else {
        result.push({ role: 'user', content: blocks.length ? blocks : [{ type: 'text', text: '…' }] })
      }
      continue
    }
    // 只回传正文：思考块的签名、联网结果都不往回带
    const text = message.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { text: string }).text)
      .join('')
      .trimEnd()
    if (!text) {
      continue
    }
    const last = result.at(-1)
    if (last?.role === 'assistant') {
      last.content.push({ type: 'text', text })
    } else {
      result.push({ role: 'assistant', content: [{ type: 'text', text }] })
    }
  }
  // 末尾是 assistant = 续写
  if (result.at(-1)?.role === 'assistant') {
    result.push({ role: 'user', content: [{ type: 'text', text: CONTINUE_PROMPT }] })
  }
  // 开头必须是 user
  while (result[0] && result[0].role !== 'user') {
    result.shift()
  }
  return result
}

/** 应用内部的请求 → Claude 请求体 */
export const toClaudeBody = (body: CreateMessageRequest) => {
  const thinking = body.thinking.type === 'enabled'
  const search = body.tools.some((tool) => tool.type === 'deepseek_web_search')
  return {
    model: body.model,
    max_tokens: MAX_TOKENS,
    // 自动缓存：长对话每轮重复发送的历史按缓存价计费（约原价的 5%~10%），5 分钟内继续聊就能命中
    cache_control: { type: 'ephemeral' },
    ...(body.system ? { system: body.system } : {}),
    messages: toClaudeMessages(body.messages),
    // 新模型的思考是 adaptive（由模型自己决定要不要想、想多久），默认不返回思考内容；
    // 打开「显示思考过程」时要求返回思考摘要，关闭时用默认（不显示，首字更快）
    ...(thinking ? { thinking: { type: 'adaptive', display: 'summarized' } } : {}),
    ...(search
      ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES }] }
      : {}),
    stream: true,
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const hostOf = (url: unknown) => {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** Claude 的停止原因 → 应用认识的四种 */
const STOP_REASONS: Record<string, string> = {
  end_turn: 'end_turn',
  stop_sequence: 'end_turn',
  // 长时间搜索被服务端暂停：当作这一轮已结束，用户可以点「继续」
  pause_turn: 'max_tokens',
  max_tokens: 'max_tokens',
  model_context_window_exceeded: 'max_tokens',
  refusal: 'refusal',
  tool_use: 'tool_use',
}

/**
 * 逐个事件转换。按 index 记住被丢掉的块（空思考、加密思考、不认识的块），
 * 它们后续的 delta / stop 也一起丢掉；搜索调用块要等参数流完才发出。
 */
export class ClaudeStreamAdapter {
  private dropped = new Set<number>()
  private pendingTool = new Map<number, { block: Record<string, unknown>; json: string }>()

  constructor(private readonly showThinking: boolean) {}

  push(raw: unknown): unknown[] {
    if (!isRecord(raw)) {
      return []
    }
    const index = typeof raw.index === 'number' ? raw.index : -1
    switch (raw.type) {
      case 'content_block_start': {
        const block = raw.content_block
        if (!isRecord(block)) {
          return []
        }
        if (block.type === 'thinking' && !this.showThinking) {
          this.dropped.add(index)
          return []
        }
        if (block.type === 'thinking') {
          return [{ ...raw, content_block: { ...block, signature: '' } }]
        }
        if (block.type === 'server_tool_use' && block.name === 'web_search') {
          this.pendingTool.set(index, { block, json: '' })
          return []
        }
        if (block.type === 'web_search_tool_result') {
          return [{ ...raw, content_block: toSearchResult(block) }]
        }
        if (block.type === 'text') {
          return [raw]
        }
        // redacted_thinking、tool_use、代码执行等界面用不到的块
        this.dropped.add(index)
        return []
      }
      case 'content_block_delta': {
        if (this.dropped.has(index)) {
          return []
        }
        const pending = this.pendingTool.get(index)
        const delta = isRecord(raw.delta) ? raw.delta : null
        if (pending) {
          if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
            pending.json += delta.partial_json
          }
          return []
        }
        // 思考签名只对回传有用，这里不回传历史思考，丢掉
        if (delta?.type === 'signature_delta') {
          return []
        }
        if (delta?.type === 'citations_delta' && !isRecord(delta.citation)) {
          return []
        }
        return [raw]
      }
      case 'content_block_stop': {
        if (this.dropped.has(index)) {
          return []
        }
        const pending = this.pendingTool.get(index)
        if (pending) {
          this.pendingTool.delete(index)
          return [
            { type: 'content_block_start', index, content_block: toSearchCall(pending.block, pending.json) },
            raw,
          ]
        }
        return [raw]
      }
      case 'message_delta': {
        const delta = isRecord(raw.delta) ? raw.delta : {}
        const reason = STOP_REASONS[String(delta.stop_reason)] ?? 'end_turn'
        return [{ ...raw, delta: { ...delta, stop_reason: reason, stop_sequence: null } }]
      }
      case 'message_start':
      case 'message_stop':
        return [raw]
      default:
        return []
    }
  }
}

const toSearchCall = (block: Record<string, unknown>, json: string) => {
  let query = ''
  try {
    const input: unknown = JSON.parse(json || '{}')
    if (isRecord(input) && typeof input.query === 'string') {
      query = input.query
    }
  } catch {
    // 参数没流完整：显示成没有关键词的搜索
  }
  if (!query && isRecord(block.input) && typeof block.input.query === 'string') {
    query = block.input.query
  }
  return {
    type: 'server_tool_use',
    id: String(block.id ?? ''),
    name: 'deepseek_web_search',
    input: { action: 'search', query, queries: query ? [query] : [] },
    caller: { type: 'direct' },
    kind: 'search',
  }
}

const toSearchResult = (block: Record<string, unknown>) => {
  const raw = block.content
  const content = Array.isArray(raw)
    ? raw.filter(isRecord).map((item) => ({
        type: 'web_search_result',
        title: String(item.title ?? item.url ?? ''),
        url: String(item.url ?? ''),
        snippet: '',
        site_icon: null,
        site_name: hostOf(item.url),
        encrypted_content: String(item.encrypted_content ?? ''),
        page_age: typeof item.page_age === 'string' ? item.page_age : null,
      }))
    : [{ type: 'web_search_tool_result_error', error_code: 'unavailable' }]
  return { type: 'web_search_tool_result', tool_use_id: String(block.tool_use_id ?? ''), content, kind: 'search' }
}
