import type { ReactNode } from 'react';
import styles from './Page.module.css';

/** Content column with the app max-width. */
export function Page({ children }: { children: ReactNode }) {
  return <div className={styles.page}>{children}</div>;
}
