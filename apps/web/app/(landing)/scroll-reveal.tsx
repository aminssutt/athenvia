"use client";

import { useEffect } from "react";

/**
 * Progressive scroll entrances for the marketing landing.
 *
 * Elements opt in with a `data-reveal` attribute. The rules that make this
 * safe everywhere:
 *
 * - Nothing is hidden by CSS alone. Every element renders visible; this
 *   component hides only the elements that are still *below* the viewport at
 *   mount, so a visitor without JavaScript — or a crawler — always sees the
 *   full page, and the content already on screen never flashes.
 * - Revealing is a one-way trip: once an element has entered the viewport it
 *   is unobserved and stays visible.
 * - Reduced motion needs no handling here: the transition that performs the
 *   reveal is collapsed to 0.01ms by the global kill switch in globals.css,
 *   so the state flip becomes an instant appearance.
 */
export function ScrollReveal() {
  useEffect(() => {
    if (!("IntersectionObserver" in window)) {
      return;
    }

    const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const belowFold = elements.filter(
      (element) => element.getBoundingClientRect().top > window.innerHeight,
    );
    if (belowFold.length === 0) {
      return;
    }

    for (const element of belowFold) {
      element.setAttribute("data-reveal-state", "hidden");
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute("data-reveal-state", "revealed");
            observer.unobserve(entry.target);
          }
        }
      },
      // Fire once ~10% of the viewport height before the element would show,
      // so the entrance is already finishing as the reader reaches it.
      { rootMargin: "0px 0px -10% 0px" },
    );

    for (const element of belowFold) {
      observer.observe(element);
    }

    return () => observer.disconnect();
  }, []);

  return null;
}
