import { useRef } from 'react'
import { useExitGhost } from '../../utils/exitGhost.js'
import { useTranslate } from '../../i18n/index.js'
import { dismissBackupPrompt, saveLatestBackup, useAutoBackup } from '../../services/autoBackup.js'
import styles from './BackupPrompt.module.css'

/** 自动备份完成、需要用户点一下才能存到文件 / 重新授权时的轻提示，不挡输入，可关闭 */
export const BackupPrompt = () => {
  const t = useTranslate()
  const prompt = useAutoBackup((state) => state.prompt)
  const ref = useRef<HTMLDivElement>(null)
  useExitGhost(ref, Boolean(prompt))
  if (!prompt) {
    return null
  }
  return (
    <div ref={ref} data-motion="toast" className={styles.prompt} role="status">
      <span className={styles.text}>
        {t(prompt === 'permission' ? 'backupNeedPermission' : 'backupReady')}
      </span>
      <button
        type="button"
        className={styles.action}
        data-ripple
        onClick={() => void saveLatestBackup()}
      >
        {t(prompt === 'permission' ? 'backupAuthorize' : 'backupSaveToFiles')}
      </button>
      <button
        type="button"
        className={styles.close}
        aria-label={t('close')}
        onClick={dismissBackupPrompt}
      >
        ×
      </button>
    </div>
  )
}
