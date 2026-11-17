import { useSettings } from '../services/settings.js'
import { onRecordingSessionEnd } from '../services/speech/audioSession.js'

/**
 * WHITE 的轻音效：全部用 Web Audio 现场合成，不加载任何音频文件。
 *
 * 音量都压得很低，只做「有感觉」的点缀；iPhone 打开静音键时 Web Audio 不出声。
 * iOS 要求声音在用户手势里解锁：第一次按下屏幕时创建 / 恢复 AudioContext。
 */

let context: AudioContext | null = null

// 录音期间创建的上下文会沿用「录音和播放」会话；录音结束后关掉，下次需要时重建
onRecordingSessionEnd(() => {
  const old = context
  context = null
  void old?.close().catch(() => {})
})

const getContext = (): AudioContext | null => {
  if (!useSettings.getState().soundEffects) {
    return null
  }
  try {
    context ??= new AudioContext()
    if (context.state === 'suspended') {
      void context.resume()
    }
    return context
  } catch {
    return null
  }
}

type Tone = {
  frequency: number
  /** 结束频率：给一点滑音 */
  to?: number
  type?: OscillatorType
  gain: number
  attack: number
  release: number
  delay?: number
}

const playTones = (tones: Tone[]) => {
  const ctx = getContext()
  if (!ctx) {
    return
  }
  const now = ctx.currentTime + 0.005
  const master = ctx.createGain()
  master.gain.value = 1
  master.connect(ctx.destination)
  for (const tone of tones) {
    const start = now + (tone.delay ?? 0)
    const end = start + tone.attack + tone.release
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = tone.type ?? 'sine'
    osc.frequency.setValueAtTime(tone.frequency, start)
    if (tone.to) {
      osc.frequency.exponentialRampToValueAtTime(tone.to, start + tone.attack + tone.release * 0.4)
    }
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(tone.gain, start + tone.attack)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
    osc.connect(gain).connect(master)
    osc.start(start)
    osc.stop(end + 0.02)
  }
}

/** 发送：一声轻快上扬的「叮」 */
export const playSendSound = () =>
  playTones([
    { frequency: 620, to: 930, gain: 0.05, attack: 0.012, release: 0.2 },
    { frequency: 1240, to: 1860, gain: 0.012, attack: 0.012, release: 0.14 },
  ])

/** 点击：极短的轻「嗒」 */
export const playTapSound = () =>
  playTones([{ frequency: 1500, to: 1100, type: 'triangle', gain: 0.022, attack: 0.003, release: 0.035 }])

/** 开始深度思考：玻璃质感的轻鸣（纯五度，慢慢散开） */
export const playThinkStartSound = () =>
  playTones([
    { frequency: 880, gain: 0.03, attack: 0.02, release: 1.3 },
    { frequency: 1320, gain: 0.016, attack: 0.03, release: 1.1, delay: 0.07 },
    { frequency: 2640, gain: 0.004, attack: 0.02, release: 0.6, delay: 0.07 },
  ])

/** 思考中的一次呼吸：低频、慢起慢落，几乎听不见 */
const playThinkPulse = () =>
  playTones([
    { frequency: 196, gain: 0.016, attack: 0.9, release: 1.3 },
    { frequency: 392, gain: 0.005, attack: 0.9, release: 1.1 },
  ])

/** 与光点呼吸同一节奏（2.4s）。返回停止函数。 */
const BREATH_MS = 2400

export const startThinkingSound = (): (() => void) => {
  playThinkStartSound()
  const timer = setInterval(playThinkPulse, BREATH_MS)
  return () => clearInterval(timer)
}

/**
 * 全局点击音：点按钮、链接时轻轻「嗒」一声。
 * 用 click 而不是 pointerdown：手指在按钮上开始滑动列表时不会误响。
 * 自带音效的按钮（如发送）加 data-sound="own" 跳过。
 */
export const setupTapSound = () => {
  // iOS 只允许在用户手势里启动音频：第一次按下屏幕时就解锁，后面的思考音才能响
  const unlock = () => {
    getContext()
  }
  document.addEventListener('pointerdown', unlock, { passive: true, capture: true })
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element ? event.target : null
      const control = target?.closest('button, [role="button"], a[href], [role="option"]')
      if (
        control &&
        !control.closest('[data-sound="own"]') &&
        !control.matches(':disabled, [aria-disabled="true"]')
      ) {
        playTapSound()
      }
    },
    { passive: true, capture: true }
  )
}
