import type { Metadata } from 'next';
import { BRAND } from '@/lib/brand';
import { TalkHome } from '@/components/talk/TalkHome';

export const metadata: Metadata = {
  title: BRAND.product,
  description: BRAND.description,
  // Deliberately NOT canonical to itself: a conversation is private to its
  // participants, so there is nothing here for a crawler to canonicalise.
  // `robots.ts` already disallows nothing site-wide, so say it here instead.
  robots: { index: false, follow: false },
};

interface ConversationProps {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ q?: string }>;
}

/**
 * TALK_CONVURL1 - THE PER-CONVERSATION URL. Before this pass a conversation
 * was selection state only (`setSelectedId` inside <TalkHome>) and the URL
 * never changed, so no link could mean "open conversation X" - the headline
 * finding of COMMS_RETIRE1 and the one gap blocking the /comms retirement.
 *
 * This route is deliberately the SAME <TalkHome> the astra home renders, not
 * a second thread view: the two-pane list+thread layout, the live conversation
 * list, and the signed-out <Door> gate are all one component, so a deep link
 * inherits every one of them rather than re-implementing (and re-gating) any.
 * Signed-out, <TalkHome> renders the Door AT THIS URL; signing in flips
 * `useSession()` reactively and the same render lands on the thread.
 *
 * `?q=` is carried through for the same reason `/` reads it (MENU_TALK1) -
 * the sidebar search must survive opening a conversation.
 */
export default async function TalkConversationPage({ params, searchParams }: ConversationProps) {
  const { conversationId } = await params;
  const { q } = await searchParams;
  return <TalkHome initialSearch={q} initialConversationId={conversationId} />;
}
