import clsx from 'clsx'
import type { CSSProperties } from 'react'
import styles from './WhiteOrb.module.css'

/** WHITE 的光点：半透明微光的玻璃小球 + 瞳孔；breathing 时呼吸 */
export const WhiteOrb = ({
  size = 14,
  breathing = false,
  className,
}: {
  size?: number
  breathing?: boolean
  className?: string
}) => (
  <span
    aria-hidden="true"
    className={clsx(styles.orb, breathing && styles.breathing, className)}
    style={{ '--orb-size': `${size}px` } as CSSProperties}
  >
    <span className={styles.halo} />
    <span className={styles.body} />
    <span className={styles.pupil} />
  </span>
)
