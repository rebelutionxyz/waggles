import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/brand';

/** Signed-in messaging content is never indexed; the door and reserved doors are. */
export default function sitemap(): MetadataRoute.Sitemap {
  const url = (path: string) => `${SITE_URL}${path}`;
  return [
    { url: url('/'), changeFrequency: 'daily', priority: 1 },
    { url: url('/chat'), changeFrequency: 'monthly', priority: 0.3 },
  ];
}
