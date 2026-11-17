import type { TranslationMessage } from '../../i18n/index.js'
import type { ApiErrorKind } from '../api/client.js'
import type {
  ChatModel,
  MessageUsage,
  ServerToolBlock,
  StopDetails,
  StopReason,
  TextCitation,
} from '../api/types.js'

/**
 * 消息附件。id 是本地标识（IndexedDB files 表的主键，原件按它存储，所有引用同一 id 的消息共用一份），
 * 导入的附件沿用导出产物里的文件 ID；本地没有原件的附件只展示文件名，不进入请求。
 * serverId 是 Files API 返回的 file_id，导入的数据或尚未上传成功的文件为 null，发送前补传。
 */
export type FileAttachment = {
  id: string
  serverId: string | null
  name: string
  size: number
  /** 附件类别；导入时沿用归档的 is_image，不由 MIME 识别结果决定。 */
  isImage: boolean
  /** 具体 MIME；导入时没有原件或无法识别的为空字符串，不影响图片身份。 */
  mimeType: string
  /** 图片格式模型不支持、也转不成支持的格式：只在界面展示，不再随请求发送 */
  unsupported?: boolean
}

/** 本地消息的分支关系；字段缺省时按线性消息列表处理。 */
type MessageBranch = {
  parentId?: string | null
  /** 当前选中的下一条消息；切换版本时保留每条分支原有的选择。 */
  selectedChildId?: string
}

export type UserMessage = MessageBranch & {
  id: string
  role: 'user'
  content: string
  files: FileAttachment[]
  createdAt: number
}

/** 思考块：thinking_delta 累积，签名随 signature_delta 到达；历史轮次的思考服务端会丢弃，不回传 */
export type ThinkingPart = {
  type: 'thinking'
  thinking: string
  signature?: string
  /** content_block_start 的时间；没有事件时间的历史块缺省 */
  startedAt?: number
  /** content_block_stop（或回复结束）的时间 */
  endedAt?: number
  /** 仅有耗时、没有事件时间时保存秒数。 */
  elapsedSeconds?: number
}

/** 文本块：text_delta 累积，citations_delta 追加引用 */
export type TextPart = {
  type: 'text'
  text: string
  citations?: TextCitation[]
  /** 服务端提示文案，仅用于展示，不作为模型回答参与上下文或续写。 */
  isTemplate?: boolean
}

/** 服务端工具调用与结果块按协议原样保存；历史请求只回传 read_link 调用与结果 */
export type ReplyBlock = ThinkingPart | TextPart | ServerToolBlock

/**
 * pending：已发出请求，还没收到事件；streaming：正在接收；
 * done：收到 message_stop；stopped：用户停止或页面关闭；error：请求或流出错
 */
export type ReplyStatus = 'pending' | 'streaming' | 'done' | 'stopped' | 'error'

export type AssistantMessage = MessageBranch & {
  id: string
  role: 'assistant'
  createdAt: number
  /** 未记录模型时为 null，续写使用当前默认模型。 */
  model: ChatModel | null
  /** 请求时是否开启深度思考 */
  thinking?: boolean
  /** 请求时是否声明 deepseek_web_search；关闭时仍声明 deepseek_read_url */
  search?: boolean
  /** 本轮请求的系统信息快照；各回答版本独立保存，续写沿用。历史消息中缺省的快照保持为空。 */
  latestReminder?: string
  /** 是否允许作为续写前缀；仍需满足回复状态与内容限制。 */
  prefix: boolean
  status: ReplyStatus
  /** 可识别的内容块按接收顺序排列；续写产生的块追加在已有块之后 */
  blocks: ReplyBlock[]
  stopReason?: StopReason
  stopDetails?: StopDetails
  /** 最近一次请求的用量，续写后更新 */
  usage?: MessageUsage
  error?: {
    /** upload：发送前补传附件失败，请求没有发出 */
    kind: ApiErrorKind | 'upload'
    message: string
    status?: number
    localMessage?: TranslationMessage
    /** 仅 upload：重新上传是否可能成功（网络、限流、服务端繁忙）；过大、格式不支持为 false */
    retryable?: boolean
  }
}

export type Message = UserMessage | AssistantMessage

/** 滚动摘要块：一段被压缩的早期轮次，持久化后下一轮直接复用。 */
export type SummaryBlock = {
  id: string
  from: number
  to: number
  text: string
  /** 已被本块覆盖的用户消息 id，避免重复摘要。 */
  msgIds: string[]
  createdAt: number
}

export type Session = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** 置顶：固定在侧栏最上方；和官端导出格式里的 pinned 对应 */
  pinned?: boolean
  /** 包含所有分支的消息，按创建顺序存储。 */
  messages: Message[]
  /** undefined 表示线性消息列表；null 表示空会话。 */
  rootMessageId?: string | null
  /** 单窗口上下文管理：被排除在请求上下文之外的用户消息 id。 */
  contextExcluded?: string[]
  /** 上下文管理：把最早 N 轮压成摘要，其余原样发送；0 / 缺省表示不压缩。 */
  contextCompress?: number
  /** 上下文管理：历史估算超过 contextBudget 时自动压缩最早轮次（未显式设置 contextCompress 时生效）。 */
  contextAutoCompress?: boolean
  /** 自动压缩的 token 水位，默认约 64k。 */
  contextBudget?: number
  /** 滚动摘要块；按时间从旧到新。 */
  summaryBlocks?: SummaryBlock[]
  /** 手动覆盖自动摘要；为空时使用滚动摘要块。 */
  summaryOverride?: string
  /** 全局自动压缩：接近 1M 上限时由模型整理出的早期对话摘要。 */
  compaction?: Compaction
}

/** 自动压缩的结果：msgIds 中的轮次不再原样发送，由 text 代替。 */
export type Compaction = {
  text: string
  /** 被这份摘要覆盖的用户消息 id（按时间顺序） */
  msgIds: string[]
  /** 摘要覆盖的原文估算 token 数 */
  coveredTokens: number
  createdAt: number
  /** 模型整理失败时退回本地截取 */
  fallback?: boolean
}

/** 会话列表元数据；消息只在打开会话时加载。 */
export type SessionSummary = Pick<Session, 'id' | 'title' | 'createdAt' | 'updatedAt' | 'pinned'>

/** 显式提取字段，避免将完整会话的消息带进列表。 */
export const toSessionSummary = (session: SessionSummary): SessionSummary => ({
  id: session.id,
  title: session.title,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  ...(session.pinned ? { pinned: true } : {}),
})
