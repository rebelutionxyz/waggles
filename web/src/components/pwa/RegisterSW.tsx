'use client';

import { useEffect } from 'react';

/* WAGGLES_PWA1 — registers the offline-shell service worker (/sw.js) once the
 * page has loaded. basePath-aware via NEXT_PUBLIC_BASE_PATH so a self-hoster
 * serving Waggles under a sub-path registers the worker at the right scope.
 * Renders nothing; failures are swallowed (a missing/denied SW must never break
 * the app — it just means no offline shell). */
export function RegisterSW() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
    const register = () => {
      void navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` }).catch(() => {
        /* no offline shell this session — non-fatal */
      });
    };
    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
