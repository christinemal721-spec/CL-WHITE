import { create } from 'zustand'

/**
 * 按轮删除的多选状态：只在一个会话里生效，切换会话或删除完成后清空。
 * anchor 是最近一次点选的那一轮；连选模式下再点一轮，就把两轮之间的全部选上。
 */
type RoundSelection = {
  sessionId: string | null
  ids: string[]
  anchor: string | null
  rangeMode: boolean
}

export const useRoundSelection = create<RoundSelection>(() => ({
  sessionId: null,
  ids: [],
  anchor: null,
  rangeMode: false,
}))

export const startRoundSelection = (sessionId: string, userId: string) =>
  useRoundSelection.setState({ sessionId, ids: [userId], anchor: userId, rangeMode: false })

/**
 * 点了某一轮：普通模式下切换选中；连选模式下选中 anchor 到这一轮之间的全部（含两端），然后退出连选。
 * order 是当前会话里所有轮次（提问 id）按时间排好的顺序。
 */
export const tapRound = (userId: string, order: string[]) =>
  useRoundSelection.setState((state) => {
    if (state.rangeMode && state.anchor && state.anchor !== userId) {
      const from = order.indexOf(state.anchor)
      const to = order.indexOf(userId)
      if (from >= 0 && to >= 0) {
        const range = order.slice(Math.min(from, to), Math.max(from, to) + 1)
        return { ids: [...new Set([...state.ids, ...range])], anchor: userId, rangeMode: false }
      }
    }
    const selected = state.ids.includes(userId)
    return {
      ids: selected ? state.ids.filter((id) => id !== userId) : [...state.ids, userId],
      anchor: selected ? state.anchor : userId,
      rangeMode: false,
    }
  })

export const setRangeMode = (rangeMode: boolean) => useRoundSelection.setState({ rangeMode })

export const setRounds = (ids: string[]) =>
  useRoundSelection.setState({ ids, anchor: ids.at(-1) ?? null, rangeMode: false })

export const endRoundSelection = () =>
  useRoundSelection.setState({ sessionId: null, ids: [], anchor: null, rangeMode: false })
