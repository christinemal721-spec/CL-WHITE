import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { ensureKatex } from './services/markdown/katex.js'
import { setupPwa } from './services/pwa.js'
import { setupTapSound } from './utils/sound.js'
import { setupRipple } from './utils/ripple.js'
import { setupAutoBackup } from './services/autoBackup.js'
import { showToast } from './components/base/toastState.js'
import './app/theme.css'
import './app/global.css'
import './app/white.css'

// 预先加载公式引擎；失败无所谓，真正显示公式时会重试
void Promise.resolve(ensureKatex()).catch(() => {})
setupTheme()
setupPwa()
setupTapSound()
setupRipple()
setupAutoBackup({ notify: (notice) => showToast(notice) })

// iOS 只有页面上有 touchstart 监听时才会触发 :active，按钮的按压反馈依赖它
document.addEventListener('touchstart', () => {}, { passive: true })

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
