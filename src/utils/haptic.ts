/**
 * 轻触感反馈。
 *
 * iOS Safari 不支持 navigator.vibrate，但 iOS 18 起点击 `<input type="checkbox" switch>`
 * 会带系统触感；这里放一个看不见的开关，在用户手势里点一下它的 label。
 * 必须在点击 / 触摸事件的同步回调里调用，否则系统不会震动。其他平台退回 vibrate。
 */
let label: HTMLLabelElement | null = null

const ensureSwitch = () => {
  if (label?.isConnected) {
    return label
  }
  label = document.createElement('label')
  label.setAttribute('aria-hidden', 'true')
  label.style.cssText =
    'position:fixed;left:-100px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;'
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.setAttribute('switch', '')
  input.tabIndex = -1
  label.appendChild(input)
  document.body.appendChild(label)
  return label
}

const supportsSwitch = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent))

export const haptic = () => {
  try {
    if (supportsSwitch()) {
      ensureSwitch().click()
    } else {
      navigator.vibrate?.(8)
    }
  } catch {
    // 触感只是锦上添花，失败就算了
  }
}
