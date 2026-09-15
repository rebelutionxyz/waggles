import type { Metadata } from 'next';
import { Page } from '@/components/shell/Page';
import { SignInScreen } from '@/components/auth/SignInScreen';

/* Signed-out entry surface — not indexed. */
export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface SignInPageProps {
  searchParams: Promise<{ next?: string }>;
}

/**
 * AUTH_LOCAL2 — the ruled /sign-in route, mounting the shared SignInForm.
 * Door.tsx (this astra's own signed-out landing at `/`) now mounts the
 * same shared component in place rather than its own hand-rolled,
 * email-only form — this route exists for the fleet-wide consistency
 * AUTH_LOCAL2 asks for (dead-end gates elsewhere can link here), not
 * because `/` needed a second path to the same capability.
 */
export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { next } = await searchParams;
  return (
    <Page>
      <SignInScreen next={next && next.startsWith('/') ? next : '/'} />
    </Page>
  );
}
