import type { Metadata } from 'next';
import { Page } from '@/components/shell/Page';
import { ResetScreen } from '@/components/auth/ResetScreen';

/* Signed-out entry surface — not indexed. */
export const metadata: Metadata = {
  title: 'Reset password',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * RESET_ROUTES1 — the `/reset` landing route `SignInForm`'s "Forgot
 * password?" flow sends the bee to (`resetPasswordForEmail(email, {
 * redirectTo: '<origin>/reset' })`). Same chrome shape as `/sign-in/page.tsx`.
 */
export default function ResetPage() {
  return (
    <Page>
      <ResetScreen />
    </Page>
  );
}
