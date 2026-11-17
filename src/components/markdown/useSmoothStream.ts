import { useEffect, useRef, useState } from 'react'

/** 每隔这么久吐一小段。逐帧一个字地吐会让整条回答每秒重排 60 次，手机上明显卡 */
const TICK_MS = 55
/** 积压的字在这么多次内吐完：积压越多吐得越快，网络一顿也不会一下蹦出一大段 */
const DRAIN_TICKS = 5
/** 每次至少吐出的字数（约 70 字/秒） */
const MIN_STEP = 4

/** 不在代理对中间截断，避免 emoji 等字符短暂显示成乱码 */
const safeEnd = (text: string, end: number) => {
  const code = text.charCodeAt(end - 1)
  return code >= 0xd800 && code <= 0xdbff ? end + 1 : end
}

/**
 * 流式输出时把一块块到达的文字按小段匀速吐出来。
 * 输出结束（active 为 false）立即显示全部内容，不拖尾。
 */
export const useSmoothStream = (content: string, active: boolean) => {
  const [shown, setShown] = useState(active ? 0 : content.length)
  const shownRef = useRef(shown)
  const targetRef = useRef(content)
  /** 上一次的内容，用来发现内容被整体替换（重新生成、切换版本） */
  const previousRef = useRef(content)
  if (!content.startsWith(previousRef.current.slice(0, shownRef.current))) {
    shownRef.current = 0
  }
  previousRef.current = content
  targetRef.current = content

  useEffect(() => {
    if (!active) {
      return
    }
    const tick = () => {
      const target = targetRef.current
      const from = Math.min(shownRef.current, target.length)
      const backlog = target.length - from
      if (backlog > 0) {
        const step = Math.max(MIN_STEP, Math.ceil(backlog / DRAIN_TICKS))
        const next = safeEnd(target, Math.min(target.length, from + step))
        shownRef.current = next
        setShown(next)
      }
    }
    const timer = setInterval(tick, TICK_MS)
    return () => clearInterval(timer)
  }, [active])

  if (!active) {
    shownRef.current = content.length
    return content
  }
  return content.slice(0, Math.min(shown, shownRef.current, content.length))
}
