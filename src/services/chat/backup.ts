import { formatDate } from '../../utils/format.js'
import * as db from './db.js'
import { replaceHistory, useChatStore } from './store.js'
import { safeFileName, sessionToMarkdown } from './sessionMarkdown.js'
import type { Session, SessionSummary } from './types.js'

import { BackupError } from './history/errors.js'

export { BackupError }

// 导入、导出与全部删除串行处理，避免读取归档时数据被清空或两个替换事务交错。
let backupQueue: Promise<unknown> = Promise.resolve()

const enqueueBackup = <T>(run: () => Promise<T>): Promise<T> => {
  const task = backupQueue.then(run)
  backupQueue = task.catch(() => {})
  return task
}

const backupFileName = (date: Date) => `deepseek_data-${formatDate(date)}.zip`

const createHistoryExport = async (
  only?: string
): Promise<{ name: string; blob: Blob }> => {
  // 列表和已加载内容保留导出开始时的快照；未打开的会话逐条读取，不填满详情缓存。
  const { sessionCache } = useChatStore.getState()
  const sessions: SessionSummary[] = useChatStore
    .getState()
    .sessions.filter((session) => !only || session.id === only)
  async function* readSessions(): AsyncGenerator<Session> {
    for (const summary of sessions) {
      const session = Object.hasOwn(sessionCache, summary.id)
        ? sessionCache[summary.id]
        : await db.loadSession(summary.id)
      if (!session) {
        throw new Error(`History session disappeared during export: ${summary.id}`)
      }
      // 详情读取期间可能重命名，归档标题与开始时的列表保持一致。
      yield { ...session, ...summary }
    }
  }
  const { exportArchive } = await import('./history/exportArchive.js')
  const now = new Date()
  const blob = await exportArchive(readSessions())
  if (only) {
    const name = `deepseek_data-${safeFileName(sessions[0]?.title ?? '')}-${formatDate(now)}.zip`
    return { name, blob }
  }
  return { name: backupFileName(now), blob }
}

/** 导出为历史会话导出格式的 ZIP，可再次导入。 */
export const exportHistory = (): Promise<{ name: string; blob: Blob }> =>
  enqueueBackup(() => createHistoryExport())

/** 只导出一个对话的 ZIP（格式同完整导出，可导入官端或另一台设备） */
export const exportSessionArchive = (id: string): Promise<{ name: string; blob: Blob }> =>
  enqueueBackup(() => createHistoryExport(id))

/** 一个对话导出成 Markdown，方便阅读和分享 */
export const exportSessionMarkdown = async (
  id: string,
  untitled: string
): Promise<{ name: string; blob: Blob }> => {
  const cached = useChatStore.getState().sessionCache
  const session = Object.hasOwn(cached, id) ? cached[id] : await db.loadSession(id)
  if (!session) {
    throw new Error(`Session not found: ${id}`)
  }
  const text = sessionToMarkdown(session, untitled)
  return {
    name: `${safeFileName(session.title || untitled)}-${formatDate(new Date())}.md`,
    blob: new Blob([text], { type: 'text/markdown;charset=utf-8' }),
  }
}

/**
 * 确认覆盖后调用：先检查 ZIP 格式与版本，校验失败时保留正在生成的回答；
 * 通过后从 ZIP 流式写入暂存，成功才替换原有会话与图片原件。返回导入的会话数。
 */
export type ImportOptions = {
  /** 用户确认过：导入前快照做不出来（太大 / 空间不足）也直接覆盖 */
  skipSnapshot?: boolean
  onProgress?: (fraction: number) => void
}

const isQuotaError = (error: unknown) =>
  error instanceof DOMException &&
  (error.name === 'QuotaExceededError' || error.name === 'UnknownError' || error.code === 22)

/** 存储写入失败统一换成「空间不足」提示，其他错误原样抛出 */
const explainStorage = (error: unknown): never => {
  if (isQuotaError(error) || (error instanceof Error && isQuotaError(error.cause))) {
    throw new BackupError('backupQuota')
  }
  throw error
}

export const importHistory = (file: File, options: ImportOptions = {}): Promise<number> =>
  enqueueBackup(async () => {
    const { checkArchiveFormat, importArchive } = await import('./history/importArchive.js')
    await checkArchiveFormat(file)
    // 浏览器空间紧张时可能清掉网站数据；大文件导入前申请持久存储
    void navigator.storage?.persist?.().catch(() => false)
    // 覆盖前先留一份完整快照；保存失败就不导入，避免不可逆丢失。
    // 当前没有任何对话时没有可丢的东西，跳过快照（也省下一份空间）。
    if (!options.skipSnapshot && useChatStore.getState().sessions.length > 0) {
      try {
        const snapshot = await createHistoryExport()
        await db.saveBackup({ id: 'pre-import', ...snapshot, createdAt: Date.now() })
      } catch (error) {
        db.reportStorageError('pre-import snapshot')(error)
        throw new BackupError('backupSnapshotFailed')
      }
    }
    return replaceHistory(() => importArchive(file, options.onProgress)).catch(explainStorage)
  })

/** 是否存在可恢复的导入前快照。 */
export const hasPreImportBackup = async (): Promise<boolean> =>
  Boolean(await db.loadBackup())

/** 把最近一次导入前快照重新导入；覆盖当前数据，但不会删掉快照本身。 */
export const restorePreImportBackup = (): Promise<number> =>
  enqueueBackup(async () => {
    const backup = await db.loadBackup()
    if (!backup) {
      throw new BackupError('backupMissing')
    }
    const file = new File([backup.blob], backup.name, { type: 'application/zip' })
    const { checkArchiveFormat, importArchive } = await import('./history/importArchive.js')
    await checkArchiveFormat(file)
    return replaceHistory(() => importArchive(file))
  })

/** 确认删除后调用：以空历史原子替换全部本地会话与附件，保留 API Key 和其他设置。 */
export const clearHistory = (): Promise<void> =>
  enqueueBackup(async () => {
    const snapshot = await createHistoryExport()
    await db.saveBackup({ id: 'pre-import', ...snapshot, createdAt: Date.now() })
    await replaceHistory(async () => {})
  })
