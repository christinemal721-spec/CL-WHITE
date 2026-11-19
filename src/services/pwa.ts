import { useDrafts } from './chat/drafts.js'
import { useChatStore } from './chat/store.js'

/**
 * PWA 壳：注册 Service Worker、申请持久存储，并处理「网站更新了，页面还是旧的」。
 *
 * 手机上的桌面网页切到后台不会被关掉，回来时还在跑旧代码；旧代码按需加载的文件
 * 在新版网站上已经不存在，会报「Loading chunk … failed」。所以：
 * 1. 回到页面时检查更新；
 * 2. 新版本接管后，没有在生成回答、输入框也是空的，就刷新到新版；否则等下次切到后台再刷新；
 * 3. 兜底：碰到这类加载失败，自动刷新一次（一分钟内最多一次，避免循环）。
 * 对话都在 IndexedDB 里，刷新不会丢；只有没发出去的草稿在内存里，所以有草稿时不刷新。
 */

const RELOAD_KEY = 'cl-white:stale-reload'
const RELOAD_GUARD_MS = 60_000
/** 切回页面后这么久之内，用户还没开始操作，可以直接刷新 */
const RESUME_WINDOW_MS = 4_000
const CHECK_INTERVAL_MS = 30 * 60_000

const STALE_CHUNK =
  /Loading (?:CSS )?chunk [\w-]+ failed|ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i

export const isStaleChunkError = (error: unknown) =>
  STALE_CHUNK.test(error instanceof Error ? `${error.name} ${error.message}` : String(error))

/** 没在生成回答、所有输入框都是空的：刷新不会打断任何东西 */
const isIdle = () =>
  Object.keys(useChatStore.getState().streaming).length === 0 &&
  [...useDrafts.getState().drafts.values()].every(
    (draft) => !draft.text.trim() && draft.attachments.length === 0
  )

const reload = () => {
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    // 存储不可用时照样刷新
  }
  window.location.reload()
}

/**
 * 碰到旧页面加载不到新文件：刷新一次换成新版。返回是否会刷新；
 * 一分钟内已经刷新过还是失败，就不再刷，交给调用方显示错误。
 */
export const recoverFromStaleChunk = (error: unknown): boolean => {
  if (!isStaleChunkError(error)) {
    return false
  }
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0
    if (Date.now() - last < RELOAD_GUARD_MS) {
      return false
    }
  } catch {
    // 读不到就当没刷新过
  }
  // 稍等一下，让「正在刷新」的提示先显示出来
  setTimeout(reload, 600)
  return true
}

/**
 * 按需加载的部分（公式引擎等）加载不到时：确认是网站更新导致的，空闲就刷新到新版；
 * 正在生成或有草稿就先记下，等切到后台再刷新，不打断用户。
 */
export const reloadForStaleChunk = (error: unknown) => {
  if (!isStaleChunkError(error)) {
    return
  }
  if (isIdle()) {
    recoverFromStaleChunk(error)
  } else {
    updatePending = true
  }
}

let resumedAt = performance.now()
let updatePending = false

const applyUpdate = () => {
  updatePending = false
  reload()
}

export const setupPwa = () => {
  if ('serviceWorker' in navigator) {
    // 首次安装时也会触发 controllerchange，那不算更新
    const hadController = Boolean(navigator.serviceWorker.controller)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) {
        return
      }
      if (performance.now() - resumedAt < RESUME_WINDOW_MS && isIdle()) {
        applyUpdate()
      } else {
        updatePending = true
      }
    })

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js')
        .then((registration) => {
          const check = () => void registration.update().catch(() => {})
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
              resumedAt = performance.now()
              check()
            } else if (updatePending && isIdle()) {
              // 切到后台时静默换成新版，回来就是新的
              applyUpdate()
            }
          })
          setInterval(check, CHECK_INTERVAL_MS)
        })
        .catch(() => {
          // file:// 或非 HTTPS 环境下注册失败是预期行为。
        })
    })
  }

  // 兜底：没被调用方处理的加载失败（代码高亮、公式等按需加载的部分）
  window.addEventListener('unhandledrejection', (event) => {
    reloadForStaleChunk(event.reason)
  })

  if (navigator.storage && typeof navigator.storage.persist === 'function') {
    void navigator.storage.persist().catch(() => {})
  }
}
