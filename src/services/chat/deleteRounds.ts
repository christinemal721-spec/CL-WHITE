import { getVisibleMessages, normalizeSession } from './branches.js'
import { buildSummary } from './context.js'
import { getContextRounds } from './reply.js'
import type { Message, Session } from './types.js'

export type DeleteRoundsResult = {
  session: Session
  /** 被移除的全部消息 id（含回答的各个版本及其分支） */
  removedIds: Set<string>
  /** 被移除消息引用过的附件 id，保存后检查是否还有别处引用 */
  fileIds: Set<string>
}

/**
 * 按轮删除：删掉用户这条提问、它下面所有回答版本，以及未选中版本各自的后续分支；
 * 当前选中回答之后的对话整体接回到这条提问原来的父节点上，不会丢失。
 * 上下文管理一起同步：排除列表、显式压缩轮数、滚动摘要块、自动压缩摘要。
 */
export const deleteRoundsFromSession = (
  original: Session,
  userIds: readonly string[]
): DeleteRoundsResult => {
  const removedIds = new Set<string>()
  const fileIds = new Set<string>()
  const before = getContextRounds(getVisibleMessages(original))
  let session = normalizeSession(original)

  for (const userId of userIds) {
    const messages = session.messages
    const user = messages.find((message) => message.id === userId)
    if (!user || user.role !== 'user') {
      continue
    }
    const childrenOf = (id: string) => messages.filter((message) => message.parentId === id)
    const replies = childrenOf(user.id)
    const selectedReply =
      replies.find((reply) => reply.id === user.selectedChildId) ?? replies.at(-1)
    const heirs = selectedReply ? childrenOf(selectedReply.id) : []

    const remove = new Set<string>([user.id])
    const stack = replies.filter((reply) => reply !== selectedReply).map((reply) => reply.id)
    if (selectedReply) {
      remove.add(selectedReply.id)
    }
    for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
      remove.add(id)
      stack.push(...childrenOf(id).map((child) => child.id))
    }

    const parentId = user.parentId ?? null
    const siblings = messages.filter(
      (message) => (message.parentId ?? null) === parentId && message.id !== user.id
    )
    const nextSelected =
      selectedReply?.selectedChildId ?? heirs.at(-1)?.id ?? siblings.at(-1)?.id ?? undefined

    const nextMessages: Message[] = []
    for (const message of messages) {
      if (remove.has(message.id)) {
        if (message.role === 'user') {
          message.files.forEach((file) => fileIds.add(file.id))
        }
        continue
      }
      let next = message
      if (selectedReply && message.parentId === selectedReply.id) {
        next = { ...next, parentId }
      }
      if (parentId !== null && message.id === parentId && message.selectedChildId === user.id) {
        next = { ...next, selectedChildId: nextSelected }
      }
      nextMessages.push(next)
    }
    remove.forEach((id) => removedIds.add(id))
    session = {
      ...session,
      messages: nextMessages,
      rootMessageId:
        session.rootMessageId === user.id ? (nextSelected ?? null) : session.rootMessageId,
    }
  }

  if (!removedIds.size) {
    return { session: original, removedIds, fileIds }
  }

  // ---------- 上下文管理同步 ----------
  const removedUsers = new Set([...removedIds])
  const compress = session.contextCompress ?? 0
  const compressRemoved = before
    .slice(0, compress)
    .filter(([user]) => removedUsers.has(user.id)).length
  const after = getContextRounds(getVisibleMessages(session))
  const byUser = new Map(after.map((round) => [round[0].id, round]))

  const summaryBlocks = session.summaryBlocks
    ?.map((block) => {
      if (!block.msgIds.some((id) => removedUsers.has(id))) {
        return block
      }
      const msgIds = block.msgIds.filter((id) => !removedUsers.has(id))
      const rounds = msgIds.flatMap((id) => {
        const round = byUser.get(id)
        return round ? [round] : []
      })
      const text = buildSummary(rounds)
      return text ? { ...block, msgIds, text } : null
    })
    .filter((block) => block !== null)

  const compactionHit = session.compaction?.msgIds.some((id) => removedUsers.has(id))

  session = {
    ...session,
    contextExcluded: session.contextExcluded?.filter((id) => !removedUsers.has(id)),
    ...(compress ? { contextCompress: Math.max(0, compress - compressRemoved) } : {}),
    ...(summaryBlocks ? { summaryBlocks } : {}),
    // 被压缩的轮次里有删掉的内容时，旧摘要作废；下次超出上限时按剩余对话重新整理
    ...(compactionHit ? { compaction: undefined } : {}),
  }
  return { session, removedIds, fileIds }
}
