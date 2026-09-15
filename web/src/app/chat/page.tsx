import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Open / Random - coming online',
  robots: { index: false },
};

/**
 * RESERVED SURFACE (TALK_CONCEPT v0.1 s3/s7 Q6): the .chat door - meet-new-
 * bees roulette (comms_roulette_queue already exists) + public rooms
 * (comms_rooms.is_public). This pass reserves the route and the framing
 * only; the matching UX is net-new and NOT built here (dispatch TALK1).
 */
export default function ChatComingOnlinePage() {
  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <span className="eyebrow">rebelution.chat - reserved door</span>
        <h1 className={styles.title}>Open / Random is coming online</h1>
        <p className={styles.sub}>
          The meet-new-bees mode of TALK - roulette-style matching and public rooms, planned on the
          same messaging engine as your DMs.
        </p>
        <ul className={styles.list}>
          <li>Roulette queue - the backing table already exists; the matching UX ships next.</li>
          <li>Public rooms - open, discovery-flavored, distinct from your private threads.</li>
        </ul>
        <Link href="/" className={styles.link}>
          &larr; Back to Messages
        </Link>
      </div>
    </div>
  );
}
