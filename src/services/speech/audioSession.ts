/**
 * iOS Safari 的音频会话（Audio Session API，Safari 16.4+ 才有）。
 *
 * 网页打开麦克风后，iOS 会把音频会话切到「录音和播放」：
 * 音量键调的是通话音量、声音可能从听筒出来。录音结束后它不会自己切回来，
 * 所以需要显式「踢」一下：先设成 playback 再立刻设回 auto，系统会重新路由，
 * 恢复成扬声器 / 媒体音量。参考 WebKit Bug 282939 中的处理方式。
 */
type AudioSessionType = 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record'

const getSession = (): { type: AudioSessionType } | null => {
  const nav = navigator as Navigator & { audioSession?: { type: AudioSessionType } }
  return nav.audioSession ?? null
}

const setType = (type: AudioSessionType) => {
  try {
    const session = getSession()
    if (session) {
      session.type = type
    }
  } catch {
    // 旧系统不支持，忽略
  }
}

/** 即将打开麦克风 */
export const enterRecordingSession = () => setType('play-and-record')

/** 麦克风已释放：恢复成普通媒体播放 */
export const leaveRecordingSession = () => {
  setType('playback')
  setType('auto')
  for (const listener of listeners) {
    listener()
  }
}

const listeners = new Set<() => void>()

/** 录音结束后需要重建音频上下文的模块（如音效）在这里登记 */
export const onRecordingSessionEnd = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
