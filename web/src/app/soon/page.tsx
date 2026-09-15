import type { Metadata } from 'next';
import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Coming online',
  robots: { index: false },
};

/**
 * Honest placeholder for TALK destinations not built yet. The chrome,
 * routing and data seam are in place; the screen lands in a later pass.
 * Never a dead link, never a fake page.
 */
export default function SoonPage() {
  return (
    <Page>
      <div className={styles.wrap}>
        <span className="eyebrow">Coming online</span>
        <h1 className={styles.title}>This corner of TALK is being built</h1>
        <p className={styles.sub}>
          Messages is live now - .chat is a reserved door, and this destination lands in a
          later pass.
        </p>
        <Link className={styles.link} href="/">
          &larr; Back to Messages
        </Link>
      </div>
    </Page>
  );
}
