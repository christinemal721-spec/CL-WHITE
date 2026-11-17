import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { exportSessionArchive, exportSessionMarkdown } from '../../services/chat/backup.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { recoverFromStaleChunk } from '../../services/pwa.js'
import { saveFile } from '../../utils/saveFile.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './ExportSessionModal.module.css'

type Format = 'markdown' | 'zip'

/**
 * 导出单个对话：先选格式生成文件，再点「保存」。
 * 分两步是因为 iPhone 只允许在点击的那一刻弹出分享面板，不能等文件生成完再弹。
 */
export const ExportSessionModal = ({
  session,
  onClose,
}: {
  session: SessionSummary
  onClose: () => void
}) => {
  const t = useTranslate()
  const [format, setFormat] = useState<Format>('markdown')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)

  const generate = async () => {
    setBusy(true)
    try {
      const { name, blob } =
        format === 'zip'
          ? await exportSessionArchive(session.id)
          : await exportSessionMarkdown(session.id, t('untitledChat'))
      setFile(new File([blob], name, { type: blob.type || 'application/octet-stream' }))
    } catch (error) {
      showToast(
        recoverFromStaleChunk(error)
          ? { key: 'staleVersionReloading' }
          : { key: 'sessionExportFailed', type: 'error' }
      )
    } finally {
      setBusy(false)
    }
  }

  const options: { key: Format; title: string; description: string }[] = [
    { key: 'markdown', title: t('sessionExportMarkdown'), description: t('sessionExportMarkdownDescription') },
    { key: 'zip', title: t('sessionExportZip'), description: t('sessionExportZipDescription') },
  ]

  return (
    <Modal
      title={t('sessionExportTitle')}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button variant="outlined" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </Button>
          {file ? (
            <Button
              onClick={async () => {
                if (await saveFile(file)) {
                  onClose()
                }
              }}
            >
              {t('sessionExportSave')}
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => void generate()}>
              {busy ? t('sessionExportGenerating') : t('sessionExportGenerate')}
            </Button>
          )}
        </>
      }
    >
      <div className={styles.options} role="radiogroup" aria-label={t('sessionExportTitle')}>
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={format === option.key}
            className={clsx(styles.option, format === option.key && styles.selected)}
            disabled={busy || Boolean(file)}
            onClick={() => setFormat(option.key)}
          >
            <span className={styles.radio} aria-hidden="true" />
            <span className={styles.text}>
              <span className={styles.optionTitle}>{option.title}</span>
              <span className={styles.optionDescription}>{option.description}</span>
            </span>
          </button>
        ))}
      </div>
      {file ? <p className={styles.ready}>{t('sessionExportReady', { name: file.name })}</p> : null}
    </Modal>
  )
}
