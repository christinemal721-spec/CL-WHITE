import { openDB } from 'idb'
import { create } from 'zustand'
import { exportHistory } from './chat/backup.js'
import * as db from './chat/db.js'
import { onReplyDone } from './chat/store.js'
import { markExported } from './backupReminder.js'
import { useSettings } from './settings.js'

/**
 * 自动备份（设置里开启，默认关闭）：每完成 10 轮对话，把全部历史导出一份 ZIP。
 * - App 内始终覆盖保存最新一份（IndexedDB）；
 * - 电脑上的 Chrome / Edge：在设置里选一次文件位置，之后静默覆盖写入那个文件；
 * - iPhone 等不支持写本地文件的环境：只能弹提醒，用户点一下才用系统分享存到「文件」，
 *   所以那里叫「备份提醒」，不点就没有真正保存。
 */
export const BACKUP_FILE_NAME = 'WHITE-全部对话备份.zip'
const BACKUP_ID = 'auto'
const COUNT_KEY = 'cl-white:auto-backup-count'
const HANDLE_KEY = 'backup-handle'
const SAVED_KEY = 'cl-white:auto-backup-saved'
const DEFAULT_EVERY = 10

type PromptKind = 'save' | 'permission' | null

type AutoBackupState = {
  /** 最近一次生成备份的时间 */
  latestAt: number | null
  /** 最近一次真正存到文件（覆盖写入 / 分享 / 下载）的那份备份的生成时间 */
  savedAt: number | null
  /** 已选的覆盖目标文件名（仅支持文件句柄的浏览器） */
  targetName: string | null
  prompt: PromptKind
  running: boolean
  error: string | null
}

export const useAutoBackup = create<AutoBackupState>(() => ({
  latestAt: null,
  savedAt: null,
  targetName: null,
  prompt: null,
  running: false,
  error: null,
}))

/** 最新一份备份放在内存里，点「存到文件」时同步取用，避免 iOS 因异步读取丢掉用户手势 */
let latestFile: File | null = null

// ---------- 文件句柄（只在支持 File System Access 的浏览器里有） ----------

type WritableHandle = {
  name: string
  queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>
  createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>
}

type PickerWindow = Window & {
  showSaveFilePicker?: (options: unknown) => Promise<WritableHandle>
}

export const supportsFileTarget = () =>
  typeof window !== 'undefined' && typeof (window as PickerWindow).showSaveFilePicker === 'function'

const kv = () =>
  openDB('white-kv', 1, {
    upgrade(database) {
      database.createObjectStore('kv')
    },
  })

const loadHandle = async (): Promise<WritableHandle | undefined> => {
  if (!supportsFileTarget()) {
    return undefined
  }
  try {
    return (await (await kv()).get('kv', HANDLE_KEY)) as WritableHandle | undefined
  } catch {
    return undefined
  }
}

const writeTo = async (handle: WritableHandle, blob: Blob) => {
  const writable = await handle.createWritable()
  await writable.write(blob)
  await writable.close()
}

// ---------- 计数 ----------

const every = () => {
  try {
    const debug = Number(localStorage.getItem('white:debug-backup-every'))
    return Number.isFinite(debug) && debug > 0 ? debug : DEFAULT_EVERY
  } catch {
    return DEFAULT_EVERY
  }
}

const readCount = () => {
  try {
    return Number(localStorage.getItem(COUNT_KEY)) || 0
  } catch {
    return 0
  }
}

const writeCount = (count: number) => {
  try {
    localStorage.setItem(COUNT_KEY, String(count))
  } catch {
    // 存储不可用时只在内存中计数
  }
}

let memoryCount = readCount()

const onRound = () => {
  if (!useSettings.getState().autoBackup) {
    return
  }
  memoryCount = readCount() + 1
  if (memoryCount >= every()) {
    memoryCount = 0
    writeCount(0)
    void runAutoBackup()
  } else {
    writeCount(memoryCount)
  }
}

/** 记下「这份备份已经存到文件」，设置页据此提示还有没有没保存的备份 */
const markSaved = () => {
  markExported()
  const savedAt = useAutoBackup.getState().latestAt
  if (!savedAt) {
    return
  }
  useAutoBackup.setState({ savedAt })
  try {
    localStorage.setItem(SAVED_KEY, String(savedAt))
  } catch {
    // 存储不可用时只在内存中记录
  }
}

// ---------- 备份 ----------

/** 生成备份并覆盖 App 内的上一版；有可写的目标文件就直接覆盖写入，否则提示存到文件。 */
export const runAutoBackup = async (): Promise<void> => {
  if (useAutoBackup.getState().running) {
    return
  }
  useAutoBackup.setState({ running: true, error: null })
  try {
    const { blob } = await exportHistory()
    const createdAt = Date.now()
    await db.saveBackup({ id: BACKUP_ID, name: BACKUP_FILE_NAME, blob, createdAt })
    latestFile = new File([blob], BACKUP_FILE_NAME, { type: 'application/zip' })
    useAutoBackup.setState({ latestAt: createdAt })

    const handle = await loadHandle()
    if (handle) {
      const permission = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted'
      if (permission === 'granted') {
        await writeTo(handle, blob)
        markSaved()
        useAutoBackup.setState({ prompt: null })
        notify({ key: 'backupWritten', params: { name: handle.name } })
        return
      }
      useAutoBackup.setState({ prompt: 'permission' })
      return
    }
    useAutoBackup.setState({ prompt: 'save' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    useAutoBackup.setState({ error: message })
    notify({ key: 'backupFailed', params: { message }, type: 'error' })
  } finally {
    useAutoBackup.setState({ running: false })
  }
}

type Notice = { key: 'backupWritten' | 'backupFailed'; params: Record<string, string>; type?: 'error' }
let notify: (notice: Notice) => void = () => {}

/**
 * 用户点「存到文件 / 授权」时调用，必须在点击回调里同步发起。
 * 有句柄：请求权限后覆盖写入；否则走系统分享（iOS 存到「文件」），不支持分享时下载。
 */
export const saveLatestBackup = async (): Promise<void> => {
  const file = latestFile
  if (!file) {
    return
  }
  try {
    // iPhone 上没有文件句柄：直接同步走分享，不能在前面 await，否则会丢掉点击手势
    const handle = supportsFileTarget() ? await loadHandle() : undefined
    if (handle) {
      const permission = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'granted'
      if (permission === 'granted') {
        await writeTo(handle, file)
        markSaved()
        useAutoBackup.setState({ prompt: null })
        notify({ key: 'backupWritten', params: { name: handle.name } })
      }
      return
    }
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] })
    } else {
      const url = URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = url
      link.download = file.name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    }
    markSaved()
    useAutoBackup.setState({ prompt: null })
  } catch (error) {
    // 用户在分享面板点了取消：保留提示，什么都不做
    if (error instanceof DOMException && error.name === 'AbortError') {
      return
    }
    notify({
      key: 'backupFailed',
      params: { message: error instanceof Error ? error.message : String(error) },
      type: 'error',
    })
  }
}

export const dismissBackupPrompt = () => useAutoBackup.setState({ prompt: null })

/** 电脑浏览器：选择覆盖目标文件；选好后如果已有备份，立即写入一次 */
export const pickBackupTarget = async (): Promise<void> => {
  const picker = (window as PickerWindow).showSaveFilePicker
  if (!picker) {
    return
  }
  try {
    const handle = await picker({
      suggestedName: BACKUP_FILE_NAME,
      types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }],
    })
    await (await kv()).put('kv', handle, HANDLE_KEY)
    useAutoBackup.setState({ targetName: handle.name, prompt: null })
    if (latestFile) {
      await writeTo(handle, latestFile)
      markSaved()
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return
    }
    throw error
  }
}

/** 启动时恢复：最近备份时间、内存里的备份文件、已选目标文件名；开始监听每轮完成 */
export const setupAutoBackup = (options: { notify: (notice: Notice) => void }) => {
  notify = options.notify
  onReplyDone(onRound)
  void (async () => {
    try {
      const backup = await db.loadBackup(BACKUP_ID)
      if (backup) {
        latestFile = new File([backup.blob], BACKUP_FILE_NAME, { type: 'application/zip' })
        useAutoBackup.setState({
          latestAt: backup.createdAt,
          savedAt: Number(localStorage.getItem(SAVED_KEY)) || null,
        })
      }
      const handle = await loadHandle()
      if (handle) {
        useAutoBackup.setState({ targetName: handle.name })
      }
    } catch {
      // 读取失败不影响使用
    }
  })()
}
