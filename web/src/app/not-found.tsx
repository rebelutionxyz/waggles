import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import styles from './not-found.module.css';

export default function NotFound() {
  return (
    <Page>
      <div className={styles.wrap}>
        <span className="eyebrow">404</span>
        <h1 className={styles.title}>Nothing here</h1>
        <p className={styles.sub}>That page does not exist, or has moved.</p>
        <Link href="/" className={styles.link}>
          &larr; Back to Messages
        </Link>
      </div>
    </Page>
  );
}
