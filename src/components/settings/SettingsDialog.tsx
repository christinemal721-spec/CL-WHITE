import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconSettingsOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import {
  BackupError,
  clearHistory,
  exportHistory,
  hasPreImportBackup,
  importHistory,
  restorePreImportBackup,
} from '../../services/chat/backup.js'
import { markExported } from '../../services/backupReminder.js'
import { recoverFromStaleChunk } from '../../services/pwa.js'
import { useChatStore } from '../../services/chat/store.js'
import { CHAT_MODELS, type ChatModel } from '../../services/api/types.js'
import { regionCodes, getRegionName, provinces } from '../../services/location.js'
import {
  isChineseBrowser,
  setLocale,
  setLocation,
  setThemePreference,
  setModel,
  setFontSize,
  setSoundEffects,
  setAutoCollapseThinking,
  setAutoCompact,
  setAutoBackup,
  useSettings,
  type ThemePreference,
} from '../../services/settings.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import styles from './Settings.module.css'
import { playSendSound } from '../../utils/sound.js'
import { haptic } from '../../utils/haptic.js'
import {
  pickBackupTarget,
  saveLatestBackup,
  supportsFileTarget,
  useAutoBackup,
} from '../../services/autoBackup.js'

/**
 * 设置弹窗：分「通用设置」（主题、语言、朗读音色、位置）与「数据管理」（API Key、导入、导出、删除）。
 * 桌面端为居中弹窗、左侧导航；移动端为底部弹层、导航横排在内容上方
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  return open ? <SettingsContent /> : null
}

const sections: { value: SettingsSection; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'general',
    label: 'settingDialogAsideGeneralOptionLabel',
    icon: <IconSettingsOutline16 />,
  },
  { value: 'data', label: 'settingDialogAsideDataOptionLabel', icon: <IconDataOutline16 /> },
]

const SettingsContent = () => {
  const t = useTranslate()
  // 打开时按调用方指定的分组选中，之后在弹窗内切换
  const [section, setSectionState] = useState(() => useSettingsDialog.getState().section)
  // 切换方向：决定新内容从哪边滑进来（点导航和左右滑动都一样）
  const [direction, setDirection] = useState<'left' | 'right' | null>(null)
  const sectionIndex = sections.findIndex((item) => item.value === section)
  const setSection = (next: SettingsSection) => {
    const to = sections.findIndex((item) => item.value === next)
    if (to === sectionIndex) {
      return
    }
    setDirection(to > sectionIndex ? 'left' : 'right')
    setSectionState(next)
  }
  const panelRef = useRef<HTMLDivElement>(null)
  useSectionSwipe(panelRef, sectionIndex, (step) => {
    const next = sections[sectionIndex + step]
    if (next) {
      setSection(next.value)
    }
  })
  // 切换分组不丢失正在输入的 API Key 与导入状态
  const apiKeyEditor = useApiKeyEditor()
  const historyImport = useHistoryImport()
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy = historyImport.busy || historyDelete.busy || replacingHistory
  return (
    <>
      <Modal
        title={t('settings')}
        closable
        motion="sheet"
        className={styles.dialog}
        mainClassName={styles.dialogMain}
        onClose={() => {
          if (!historyDelete.busy) {
            closeSettings()
          }
        }}
      >
        <div role="tablist" className={styles.navigation}>
          {sections.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={section === item.value}
              className={clsx(styles.navItem, section === item.value && styles.navItemActive)}
              onClick={() => setSection(item.value)}
            >
              {item.icon}
              {t(item.label)}
            </button>
          ))}
        </div>
        <div
          key={section}
          ref={panelRef}
          role="tabpanel"
          data-motion={direction ? `slide-${direction}` : 'fade'}
          className={styles.content}
        >
          {section === 'general' ? (
            <>
              <ThemeSetting />
              <LocaleSetting />
              <FontSizeSetting />
              <AutoCollapseThinkingSetting />
              <AutoCompactSetting />
              <SoundEffectsSetting />
              <LocationSetting />
              <DevCreditsSetting />
            </>
          ) : (
            <>
              <ApiKeyField editor={apiKeyEditor} />
              <ModelSetting />
              <ImportHistory historyImport={historyImport} disabled={historyBusy} />
              <ExportHistory disabled={historyBusy} />
              <AutoBackupSetting />
              <RestorePreImportBackup disabled={historyBusy} />
              <SettingCell
                label={t('deleteAllSessions')}
                status={null}
                action={
                  <Button
                    variant="dangerOutlined"
                    size="m"
                    className={styles.cellButton}
                    disabled={historyBusy}
                    onClick={historyDelete.open}
                  >
                    {t('delete')}
                  </Button>
                }
              />
            </>
          )}
        </div>
      </Modal>
      {historyImport.file ? <ImportConfirm historyImport={historyImport} /> : null}
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
    </>
  )
}

/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

const LocationSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const province =
    location?.region === 'CN'
      ? provinces.find((item) => item.code === location.province)
      : undefined

  return (
    <SettingCell
      label={t('settingsLocation')}
      status={null}
      className={styles.locationCell}
      action={
        <div className={styles.locationSelectors}>
          {isChineseBrowser() ? (
            <>
              <Select
                ariaLabel={t('settingsLocationProvince')}
                className={styles.provinceSelect}
                value={province?.code ?? ''}
                placeholder={t('settingsLocationProvince')}
                options={provinces.map((item) => ({ value: item.code, label: item.name }))}
                onChange={(value) => {
                  if (value !== province?.code) {
                    setLocation({ region: 'CN', province: value })
                  }
                }}
              />
              <Select
                ariaLabel={t('settingsLocationCity')}
                className={styles.citySelect}
                value={province ? (location?.city ?? '') : ''}
                disabled={!province?.cities.length}
                placeholder={t('settingsLocationCity')}
                options={
                  province?.cities.map((item) => ({ value: item.code, label: item.name })) ?? []
                }
                onChange={(value) => {
                  if (province) {
                    setLocation({ region: 'CN', province: province.code, city: value })
                  }
                }}
              />
            </>
          ) : (
            <Select
              ariaLabel={t('settingsLocationRegion')}
              className={styles.regionSelect}
              value={location?.region ?? ''}
              placeholder={t('settingsLocationRegion')}
              options={regionCodes
                .map((code) => ({ value: code, label: getRegionName(code, locale) }))
                .sort((a, b) => a.label.localeCompare(b.label, locale))}
              onChange={(value) => setLocation({ region: value })}
            />
          )}
        </div>
      }
    />
  )
}

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={setLocale}
        />
      }
    />
  )
}

/** 正文字体大小：影响对话里的正文、气泡和标题 */
const FontSizeSetting = () => {
  const t = useTranslate()
  const fontSize = useSettings((state) => state.fontSize)
  return (
    <SettingCell
      label={t('settingsFontSize')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsFontSize')}
          value={fontSize}
          options={[
            { value: 'xsmall', label: t('settingsFontSizeXSmall') },
            { value: 'small', label: t('settingsFontSizeSmall') },
            { value: 'standard', label: t('settingsFontSizeStandard') },
            { value: 'large', label: t('settingsFontSizeLarge') },
            { value: 'xlarge', label: t('settingsFontSizeXLarge') },
          ]}
          onChange={setFontSize}
        />
      }
    />
  )
}

/** 深度思考自动折叠：正文开始输出后收起思考过程 */
const OnOffSelect = ({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (value: boolean) => void
}) => {
  const t = useTranslate()
  return (
    <Select
      ariaLabel={label}
      value={value ? 'on' : 'off'}
      options={[
        { value: 'on', label: t('settingsSoundEffectsOn') },
        { value: 'off', label: t('settingsSoundEffectsOff') },
      ]}
      onChange={(next) => onChange(next === 'on')}
    />
  )
}

const AutoCompactSetting = () => {
  const t = useTranslate()
  const autoCompact = useSettings((state) => state.autoCompact)
  return (
    <SettingCell
      label={t('settingsAutoCompact')}
      description={t('settingsAutoCompactDescription')}
      status={null}
      action={
        <OnOffSelect
          label={t('settingsAutoCompact')}
          value={autoCompact}
          onChange={setAutoCompact}
        />
      }
    />
  )
}

const formatBackupTime = (time: number) => {
  const date = new Date(time)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const AutoBackupSetting = () => {
  const t = useTranslate()
  const autoBackup = useSettings((state) => state.autoBackup)
  const latestAt = useAutoBackup((state) => state.latestAt)
  const targetName = useAutoBackup((state) => state.targetName)
  const fileTarget = supportsFileTarget()
  const savedAt = useAutoBackup((state) => state.savedAt)
  const latest = latestAt
    ? t('settingsBackupLatest', { time: formatBackupTime(latestAt) }) +
      (savedAt === latestAt ? '' : t('settingsBackupUnsaved'))
    : t('settingsBackupNone')
  // 不能直接写文件的环境（iPhone 等）只是提醒，名字和说明都如实写
  const title = t(fileTarget ? 'settingsAutoBackup' : 'settingsBackupReminder')
  return (
    <>
      <SettingCell
        label={title}
        description={t(
          fileTarget ? 'settingsAutoBackupDescription' : 'settingsBackupReminderDescription'
        )}
        status={null}
        action={<OnOffSelect label={title} value={autoBackup} onChange={setAutoBackup} />}
      />
      {autoBackup ? (
        <SettingCell
          label={t(fileTarget ? 'settingsBackupTarget' : 'settingsBackupManual')}
          description={`${
            fileTarget
              ? targetName
                ? t('settingsBackupTargetPicked', { name: targetName })
                : t('settingsBackupTargetEmpty')
              : t('settingsBackupTargetIos')
          } ${latest}`}
          status={null}
          action={
            fileTarget ? (
              <Button
                variant="outlined"
                size="m"
                className={styles.cellButton}
                onClick={() => void pickBackupTarget()}
              >
                {t('settingsBackupPick')}
              </Button>
            ) : (
              <Button
                variant="outlined"
                size="m"
                className={styles.cellButton}
                disabled={!latestAt}
                onClick={() => void saveLatestBackup()}
              >
                {t('backupSaveToFiles')}
              </Button>
            )
          }
        />
      ) : null}
    </>
  )
}

const AutoCollapseThinkingSetting = () => {
  const t = useTranslate()
  const autoCollapse = useSettings((state) => state.autoCollapseThinking)
  return (
    <SettingCell
      label={t('settingsAutoCollapseThinking')}
      description={t('settingsAutoCollapseThinkingDescription')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsAutoCollapseThinking')}
          value={autoCollapse ? 'on' : 'off'}
          options={[
            { value: 'on', label: t('settingsSoundEffectsOn') },
            { value: 'off', label: t('settingsSoundEffectsOff') },
          ]}
          onChange={(value) => setAutoCollapseThinking(value === 'on')}
        />
      }
    />
  )
}

/** 音效：发送、深度思考、点击时的轻音效 */
const SoundEffectsSetting = () => {
  const t = useTranslate()
  const soundEffects = useSettings((state) => state.soundEffects)
  return (
    <SettingCell
      label={t('settingsSoundEffects')}
      description={t('settingsSoundEffectsDescription')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsSoundEffects')}
          value={soundEffects ? 'on' : 'off'}
          options={[
            { value: 'on', label: t('settingsSoundEffectsOn') },
            { value: 'off', label: t('settingsSoundEffectsOff') },
          ]}
          onChange={(value) => {
            setSoundEffects(value === 'on')
            if (value === 'on') {
              playSendSound()
            }
          }}
        />
      }
    />
  )
}

/** 朗读音色：tide（暗潮，男声，默认）/ stella（海星，女声） */

/** 覆盖导入的二次确认，叠在设置弹窗上 */
const ImportConfirm = ({
  historyImport,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      className={styles.importConfirm}
      onClose={historyImport.cancel}
      footer={
        <>
          <Button variant="outlined" size="m" autoFocus onClick={historyImport.cancel}>
            {t('cancel')}
          </Button>
          <Button variant="dangerOutlined" size="m" onClick={() => void historyImport.confirm()}>
            {t(
              historyImport.skipSnapshot
                ? 'historyImportSkipSnapshotConfirm'
                : 'historyImportConfirm'
            )}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>
        {t(
          historyImport.skipSnapshot
            ? 'historyImportSkipSnapshotDescription'
            : 'historyImportConfirmDescription'
        )}
      </div>
    </Modal>
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

/**
 * 主题项：标题下方浅色 / 深色 / 跟随系统三个选块。
 * 与下方语言选项连续排列。
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** `reason` 为失败原因的文案 key，展示时按当前语言翻译后填入 `message` 参数。 */
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/** 导出失败附带原因：预期的错误用对应文案作原因，其他错误用错误信息。 */
const errorStatus = (key: TranslationKey, error: unknown): Status =>
  // 网站刚更新、页面还是旧版：自动刷新，不显示一串看不懂的报错
  recoverFromStaleChunk(error)
    ? { key: 'staleVersionReloading' }
    : {
        key,
        ...(error instanceof BackupError
          ? { reason: error.key }
          : { params: { message: error instanceof Error ? error.message : String(error) } }),
        error: true,
      }

/**
 * 设置内容区左右滑动切换分组：内容跟手，滑过四分之一或快速一甩就切过去，否则弹回；
 * 两端再往外拖有阻尼。竖向滚动不受影响。
 */
const useSectionSwipe = (
  panelRef: { current: HTMLDivElement | null },
  index: number,
  onSwitch: (step: 1 | -1) => void
) => {
  const onSwitchRef = useRef(onSwitch)
  onSwitchRef.current = onSwitch
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) {
      return
    }
    let drag: {
      x: number
      y: number
      time: number
      dx: number
      horizontal: boolean | null
    } | null = null
    const reset = () => {
      panel.style.transition = ''
      panel.style.transform = ''
      panel.style.opacity = ''
    }
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        drag = null
        return
      }
      const touch = event.touches[0]
      drag = { x: touch.clientX, y: touch.clientY, time: event.timeStamp, dx: 0, horizontal: null }
    }
    const onMove = (event: TouchEvent) => {
      if (!drag) {
        return
      }
      const touch = event.touches[0]
      const dx = touch.clientX - drag.x
      const dy = touch.clientY - drag.y
      if (drag.horizontal === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
          return
        }
        drag.horizontal = Math.abs(dx) > Math.abs(dy) * 1.3
        if (!drag.horizontal) {
          drag = null
          return
        }
        panel.style.transition = 'none'
      }
      event.preventDefault()
      const atEdge = (dx > 0 && index === 0) || (dx < 0 && index === sections.length - 1)
      drag.dx = atEdge ? dx * 0.25 : dx
      panel.style.transform = `translateX(${drag.dx}px)`
      panel.style.opacity = String(1 - Math.min(0.5, Math.abs(drag.dx) / 600))
    }
    const onEnd = (event: TouchEvent) => {
      if (!drag?.horizontal) {
        drag = null
        return
      }
      const { dx, time } = drag
      drag = null
      const width = panel.getBoundingClientRect().width
      const velocity = Math.abs(dx) / Math.max(1, event.timeStamp - time)
      const step: 1 | -1 = dx < 0 ? 1 : -1
      const target = index + step
      if (
        target >= 0 &&
        target < sections.length &&
        (Math.abs(dx) > width * 0.25 || velocity > 0.4)
      ) {
        haptic()
        panel.style.transition = 'transform 140ms cubic-bezier(0.4, 0, 1, 1), opacity 140ms ease'
        panel.style.transform = `translateX(${dx < 0 ? -width * 0.35 : width * 0.35}px)`
        panel.style.opacity = '0'
        window.setTimeout(() => onSwitchRef.current(step), 130)
      } else {
        panel.style.transition =
          'transform 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease'
        panel.style.transform = 'translateX(0)'
        panel.style.opacity = '1'
        window.setTimeout(reset, 300)
      }
    }
    panel.addEventListener('touchstart', onStart, { passive: true })
    panel.addEventListener('touchmove', onMove, { passive: false })
    panel.addEventListener('touchend', onEnd)
    panel.addEventListener('touchcancel', onEnd)
    return () => {
      panel.removeEventListener('touchstart', onStart)
      panel.removeEventListener('touchmove', onMove)
      panel.removeEventListener('touchend', onEnd)
      panel.removeEventListener('touchcancel', onEnd)
    }
  }, [panelRef, index])
}

const CREDITS = [
  { key: 'harness', name: 'DeepSeek Harness', height: 26 },
  { key: 'deepseek', name: 'DeepSeek', height: 32 },
  { key: 'claude', name: 'Claude', height: 30 },
  { key: 'python', name: 'Python', height: 36 },
] as const

/** 通用设置最下方：开发清单。点开展示开发用到的工具标志与版权说明 */
const DevCreditsSetting = () => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  return (
    <>
      <SettingCell
        label={t('devCredits')}
        description={t('devCreditsDescription')}
        status={null}
        action={
          <Button
            variant="outlined"
            size="m"
            className={styles.cellButton}
            onClick={() => setOpen(true)}
          >
            {t('devCreditsView')}
          </Button>
        }
      />
      {open ? (
        <Modal
          title={t('devCredits')}
          closable
          className={styles.credits}
          onClose={() => setOpen(false)}
        >
          <ul className={styles.creditList}>
            {CREDITS.map((item, index) => (
              <li
                key={item.key}
                className={styles.creditItem}
                data-motion="rise"
                style={{ animationDelay: `${80 + index * 60}ms` }}
              >
                <img
                  className={clsx(styles.creditLogo, styles.creditLight)}
                  src={`icons/credits/${item.key}-light.png`}
                  alt={item.name}
                  style={{ height: item.height }}
                  draggable={false}
                />
                <img
                  className={clsx(styles.creditLogo, styles.creditDark)}
                  src={`icons/credits/${item.key}-dark.png`}
                  alt=""
                  aria-hidden="true"
                  style={{ height: item.height }}
                  draggable={false}
                />
              </li>
            ))}
          </ul>
          {/* 中英文固定同时显示，不随界面语言切换 */}
          <div className={styles.copyright}>
            <p lang="zh-CN">版权所有 DeepSeek，欢迎继续开发功能、沟通交流，请勿直接商用。</p>
            <p lang="en">
              Copyright DeepSeek. You are welcome to keep developing features and to get in touch;
              please do not use it commercially as-is.
            </p>
          </div>
        </Modal>
      ) : null}
    </>
  )
}

const SettingCell = ({
  label,
  description,
  note,
  status,
  action,
  className,
}: {
  label: string
  description?: string
  /** 描述下方再小一档的补充说明 */
  note?: string
  status: Status
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
        {status || description ? (
          <div className={clsx(styles.description, status?.error && styles.error)}>
            {status
              ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
              : description}
          </div>
        ) : null}
        {note ? <div className={styles.note}>{note}</div> : null}
      </div>
      {action}
    </div>
  )
}

/** 选择对话用的 Claude 模型；价格写在说明里，方便对比 */
const ModelSetting = () => {
  const t = useTranslate()
  const model = useSettings((state) => state.model)
  return (
    <SettingCell
      label={t('settingsModel')}
      description={t('settingsModelDescription')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsModel')}
          value={model}
          options={CHAT_MODELS.map((value: ChatModel) => ({ value, label: t(MODEL_LABELS[value]) }))}
          onChange={setModel}
        />
      }
    />
  )
}

const MODEL_LABELS = {
  'claude-opus-5-5': 'modelOpus',
  'claude-sonnet-5-5': 'modelSonnet',
  'claude-haiku-5-5': 'modelHaiku',
  'claude-fable-5-2': 'modelFable',
} as const

/** 选文件后先提示覆盖；确认后才检查文件并执行导入，任何错误都提示导入失败。 */
const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  /** 第二步：导入前备份做不出来，问一句要不要直接覆盖 */
  const [skipSnapshot, setSkipSnapshot] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const importing = useRef(false)

  const confirm = async () => {
    if (!file || importing.current) {
      return
    }
    const current = file
    importing.current = true
    setFile(null)
    setBusy(true)
    setStatus({ key: 'historyImporting', params: { percent: 0 } })
    let lastPercent = 0
    try {
      const count = await importHistory(current, {
        skipSnapshot,
        onProgress: (fraction) => {
          const percent = Math.min(99, Math.floor(fraction * 100))
          if (percent !== lastPercent) {
            lastPercent = percent
            setStatus({ key: 'historyImporting', params: { percent } })
          }
        },
      })
      setSkipSnapshot(false)
      setStatus({ key: count === 1 ? 'historyImportedOne' : 'historyImported', params: { count } })
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('history import failed', error)
      if (error instanceof BackupError && error.key === 'backupSnapshotFailed' && !skipSnapshot) {
        setStatus(null)
        setSkipSnapshot(true)
        setFile(current)
      } else {
        setSkipSnapshot(false)
        setStatus(
          error instanceof BackupError && error.key !== 'backupIncomplete'
            ? { key: 'historyImportFailedReason', reason: error.key, error: true }
            : { key: 'historyImportFailed', error: true }
        )
      }
    } finally {
      importing.current = false
      setBusy(false)
    }
  }

  const cancel = () => {
    setFile(null)
    setSkipSnapshot(false)
  }

  return { file, skipSnapshot, busy, status, select: setFile, cancel, confirm }
}

/** 导入 = 覆盖：用选中文件替换本地全部会话与附件。 */
const ImportHistory = ({
  historyImport,
  disabled,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <SettingCell
      label={t('historyImport')}
      description={t('historyImportDescription')}
      status={historyImport.status}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <IconUploadOutline14 />
            {t('upload')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                historyImport.select(file)
              }
            }}
          />
        </>
      }
    />
  )
}

/** 将全部会话及图片导出为 ZIP 文件并下载 */
/** 导入前快照：只在最近一次导入后被覆盖，用来撤销误覆盖。 */
const RestorePreImportBackup = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  useEffect(() => {
    let live = true
    hasPreImportBackup()
      .then((value) => {
        if (live) {
          setAvailable(value)
        }
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const onRestore = async () => {
    setBusy(true)
    setStatus(null)
    try {
      await restorePreImportBackup()
      setAvailable(await hasPreImportBackup())
      showToast(t('restorePreImportBackupDone'))
    } catch (error) {
      setStatus(errorStatus('restorePreImportBackupFailed', error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingCell
      label={t('restorePreImportBackup')}
      description={
        available ? t('restorePreImportBackupDescription') : t('restorePreImportBackupMissing')
      }
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || !available}
          onClick={() => void onRestore()}
        >
          {t('restorePreImportBackup')}
        </Button>
      }
    />
  )
}

const ExportHistory = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const onExport = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const { name, blob } = await exportHistory()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      markExported()
    } catch (error) {
      setStatus(errorStatus('historyExportFailed', error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingCell
      label={t('exportAllLabel')}
      description={t('historyExportDescription')}
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || empty}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
      }
    />
  )
}
