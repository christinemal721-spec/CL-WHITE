import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  fallback?: ReactNode
}

type State = {
  failed: boolean
}

/**
 * 单条消息错误边界：某条 Markdown/代码块/公式渲染出错时只跳过这一条，
 * 不让整条会话白屏。错误只记录到控制台，不打断其他消息。
 */
export class MessageErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[message] render failed', error, info)
  }

  override render() {
    if (this.state.failed) {
      return (
        this.props.fallback ?? (
          <div
            style={{
              padding: '10px 16px',
              color: 'var(--dsw-alias-label-tertiary)',
              fontSize: 12,
              lineHeight: '18px',
            }}
          >
            这条消息渲染失败，已跳过。
          </div>
        )
      )
    }
    return this.props.children
  }
}
