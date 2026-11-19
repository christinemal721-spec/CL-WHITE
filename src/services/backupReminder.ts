import { create } from 'zustand'

/**
 * 备份提醒：超过 REMIND_DAYS 天没导出过完整的 zip，侧栏底部提示一下。
 * 「导出过」包括设置里的导出全部、自动备份写入文件或存到「文件」；单个对话的导出不算。
 * 新用户从第一次打开开始算，不会一上来就提醒。
 */
const LAST_KEY = 'chat-demo:last-export'
const FIRST_KEY = 'chat-demo:first-seen'
const SNOOZE_KEY = 'chat-demo:backup-snooze'

export const REMIND_DAYS = 7
const SNOOZE_DAYS = 2
const DAY = 86_400_000

const read = (key: string) => {
  try {
    return Number(localStorage.getItem(key)) || null
  } catch {
    return null
  }
}

const write = (key: string, value: number) => {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // 存储不可用时只在内存中记录
  }
}

const firstSeen = () => {
  const saved = read(FIRST_KEY)
  if (saved) {
    return saved
  }
  const now = Date.now()
  write(FIRST_KEY, now)
  return now
}

type ReminderState = {
  lastExportAt: number | null
  firstSeenAt: number
  snoozeUntil: number | null
}

export const useBackupReminder = create<ReminderState>(() => ({
  lastExportAt: read(LAST_KEY),
  firstSeenAt: firstSeen(),
  snoozeUntil: read(SNOOZE_KEY),
}))

/** 完整备份成功后调用 */
export const markExported = () => {
  const now = Date.now()
  write(LAST_KEY, now)
  useBackupReminder.setState({ lastExportAt: now })
}

/** 「稍后」：两天内不再提醒 */
export const snoozeBackupReminder = () => {
  const until = Date.now() + SNOOZE_DAYS * DAY
  write(SNOOZE_KEY, until)
  useBackupReminder.setState({ snoozeUntil: until })
}

/** 距上次备份（从没备份过则从第一次使用算起）过了几天；未到提醒时间返回 null */
export const overdueDays = (state: ReminderState, now: number) => {
  if (state.snoozeUntil && now < state.snoozeUntil) {
    return null
  }
  const since = state.lastExportAt ?? state.firstSeenAt
  const days = Math.floor((now - since) / DAY)
  return days >= REMIND_DAYS ? days : null
}
