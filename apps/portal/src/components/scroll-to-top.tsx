import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Resets scroll on navigation. Honours prefers-reduced-motion, which the
 * original `window.scrollTo({behavior:'smooth'})` did not: the CSS guard covers
 * `scroll-behavior` but has no effect on the JavaScript option.
 */
export function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }, [pathname]);

  return null;
}
