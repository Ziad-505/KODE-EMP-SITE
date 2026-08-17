import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Scroll reveal for the inner pages.
 *
 * Every page except the home page was completely static: the data arrived, the
 * rows appeared, and nothing else happened. Rather than add a motion library
 * and a wrapper component around every list item, one observer per route walks
 * the elements that opt in with `data-reveal` and flips `data-revealed` on them
 * as they cross into view. The animation itself is CSS, chosen per tab by the
 * `data-reveal` value, so a tab's motion can change without touching a route.
 *
 * Stagger is expressed as `--reveal-index` on each element, which the CSS turns
 * into a transition delay. Indices are assigned per group, so a list of eight
 * rows staggers within itself instead of inheriting an offset from whatever
 * happened to render above it.
 *
 * Under `prefers-reduced-motion` the observer never attaches and every element
 * is marked revealed on the first pass, so content is visible with no motion.
 */

const STAGGER_CAP = 10;

export function useReveal(): void {
  const location = useLocation();

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // The route's elements are not in the DOM until after paint on a lazy
    // route, and data-driven lists mount later still. A short observer on the
    // document catches both without polling.
    let observer: IntersectionObserver | null = null;
    const seen = new WeakSet<Element>();

    const reveal = (element: Element) => {
      element.setAttribute('data-revealed', 'true');
    };

    if (!reduce) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            reveal(entry.target);
            observer?.unobserve(entry.target);
          }
        },
        // Fire slightly before the element reaches the fold, so the motion has
        // finished by the time it is properly in the reading area.
        { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
      );
    }

    const scan = () => {
      const groups = new Map<Element, number>();
      for (const element of document.querySelectorAll('[data-reveal]')) {
        if (seen.has(element)) continue;
        seen.add(element);

        const parent = element.parentElement ?? document.body;
        const index = groups.get(parent) ?? 0;
        groups.set(parent, index + 1);
        (element as HTMLElement).style.setProperty(
          '--reveal-index',
          String(Math.min(index, STAGGER_CAP)),
        );

        if (observer) observer.observe(element);
        else reveal(element);
      }
    };

    scan();

    /*
     * Safety net. `[data-reveal]` starts at `opacity: 0`, so anything that
     * stops the observer firing — a browser without IntersectionObserver, a
     * print stylesheet, a page rendered inside a container the observer cannot
     * see — would leave the content permanently invisible rather than merely
     * unanimated. Content hiding itself is a far worse failure than content
     * appearing without a transition, so everything is force-revealed shortly
     * after mount regardless.
     */
    const failsafe = window.setTimeout(() => {
      for (const element of document.querySelectorAll('[data-reveal]:not([data-revealed])')) {
        const rect = element.getBoundingClientRect();
        // Only elements at or above the fold; the rest still animate on scroll.
        if (rect.top < window.innerHeight * 1.5) reveal(element);
      }
    }, 1200);

    // Lists arrive after their query resolves. A mutation observer is cheaper
    // and more accurate here than a timer, and it is torn down with the route.
    const mutations = new MutationObserver(scan);
    mutations.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.clearTimeout(failsafe);
      mutations.disconnect();
      observer?.disconnect();
    };
  }, [location.pathname]);
}
