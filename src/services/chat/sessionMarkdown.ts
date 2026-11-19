import { formatDate } from '../../utils/format.js'
import { getVisibleMessages } from './branches.js'
import type { Session } from './types.js'

/**
 * 单个对话导出成 Markdown：方便阅读、分享或存进笔记。
 * 只导出当前看到的分支；思考过程放进可折叠的 <details>，图片和文件只写文件名。
 */
export const sessionToMarkdown = (session: Session, untitled: string): string => {
  const title = session.title || untitled
  const lines = [`# ${title}`, '', `> 导出自 DS WHITE · ${formatDate(new Date())}`, '']
  for (const message of getVisibleMessages(session)) {
    lines.push('---', '')
    if (message.role === 'user') {
      lines.push('### 我', '')
      if (message.content.trim()) {
        lines.push(message.content.trim(), '')
      }
      for (const file of message.files) {
        lines.push(`*[${file.isImage ? '图片' : '文件'}：${file.name}]*`, '')
      }
      continue
    }
    lines.push('### DeepSeek', '')
    const thinking = message.blocks
      .flatMap((block) => (block.type === 'thinking' && block.thinking.trim() ? [block.thinking.trim()] : []))
      .join('\n\n')
    if (thinking) {
      lines.push('<details><summary>思考过程</summary>', '', thinking, '', '</details>', '')
    }
    const text = message.blocks
      .flatMap((block) => (block.type === 'text' && !block.isTemplate ? [block.text] : []))
      .join('')
      .trim()
    if (text) {
      lines.push(text, '')
    }
  }
  return lines.join('\n')
}

/** 文件名里去掉系统不允许的字符，太长的标题截断 */
export const safeFileName = (title: string) =>
  title.replace(/[\\/:*?"<>|\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'chat'
