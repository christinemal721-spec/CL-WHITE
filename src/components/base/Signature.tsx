import clsx from 'clsx'
import type { CSSProperties } from 'react'
import styles from './Signature.module.css'

const SOURCES = {
  gradient: 'icons/signature.png',
  /** 侧栏用的纯色版 */
  solid: 'icons/signature-solid.png',
}

/**
 * Chris 与 WHITE 的签名。
 * motion：breath 光晕随呼吸明暗（边栏）；write 打开时从左到右写出来（欢迎页）。
 */
export const Signature = ({
  width,
  motion,
  alt,
  variant = 'gradient',
  splashTarget = false,
  glow = true,
  className,
}: {
  width: number
  /** still：静止，只有常亮的光晕（开屏刚写过签名时的欢迎页） */
  motion: 'breath' | 'write' | 'still'
  alt: string
  variant?: keyof typeof SOURCES
  /** 开屏签名的接力落点 */
  splashTarget?: boolean
  /** false：只显示签名本身，不垫光晕（侧栏） */
  glow?: boolean
  className?: string
}) => (
  <span
    role="img"
    aria-label={alt}
    data-splash-target={splashTarget ? '' : undefined}
    className={clsx(styles.signature, styles[motion], className)}
    style={{ '--sig-width': `${width}px` } as CSSProperties}
  >
    {glow ? <img className={styles.glow} src={SOURCES[variant]} alt="" draggable={false} /> : null}
    <img className={styles.ink} src={SOURCES[variant]} alt="" draggable={false} />
  </span>
)
