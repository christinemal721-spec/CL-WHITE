import { create } from 'zustand'

/** 按轮删除的多选状态：只在一个会话里生效，切换会话或删除完成后清空。 */
type RoundSelection = {
  sessionId: string | null
  ids: string[]
}

export const useRoundSelection = create<RoundSelection>(() => ({ sessionId: null, ids: [] }))

export const startRoundSelection = (sessionId: string, userId: string) =>
  useRoundSelection.setState({ sessionId, ids: [userId] })

export const toggleRound = (userId: string) =>
  useRoundSelection.setState((state) => ({
    ids: state.ids.includes(userId)
      ? state.ids.filter((id) => id !== userId)
      : [...state.ids, userId],
  }))

export const setRounds = (ids: string[]) => useRoundSelection.setState({ ids })

export const endRoundSelection = () => useRoundSelection.setState({ sessionId: null, ids: [] })
