"use client";

import type { Scope } from "animejs";
import { useEffect } from "react";

/**
 * The landing's JavaScript motion layer, built on anime.js v4.
 *
 * Ground rules, in the same spirit as the CSS motion system:
 *
 * - Progressive enhancement only. The server renders everything visible; this
 *   layer hides below-fold elements *after* mount and reveals them on scroll,
 *   so a visitor without JavaScript (or before hydration) sees the full page.
 * - `prefers-reduced-motion` opts out of the entire layer before anything is
 *   hidden or animated — the CSS kill switch cannot reach JS-driven motion,
 *   so the gate lives here.
 * - The engine (~10 kB of lazy JS) loads through a dynamic import inside the
 *   effect: it never rides in the route's first load (perf budget #102).
 * - `[data-motion-active]` on the landing root hands the ticker and the phone
 *   float from their CSS keyframes to this layer, so the two never fight over
 *   the same transform.
 */
export function LandingMotion() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const root = document.querySelector<HTMLElement>("[data-landing-root]");
    if (!root) {
      return;
    }

    let disposed = false;
    let scope: Scope | undefined;

    void (async () => {
      const { animate, createAnimatable, createScope, onScroll, stagger, utils } =
        await import("animejs");
      if (disposed) {
        return;
      }

      root.dataset.motionActive = "";

      scope = createScope({ root }).add(() => {
        const belowFold = (element: Element) =>
          element.getBoundingClientRect().top > window.innerHeight;

        const enter = "bottom-=8% top";

        /* Single reveals: rise and settle as they enter the viewport. */
        for (const $el of utils.$("[data-reveal]")) {
          if (!belowFold($el)) continue;
          utils.set($el, { opacity: 0, y: "2rem" });
          animate($el, {
            opacity: 1,
            y: 0,
            duration: 850,
            ease: "out(3)",
            autoplay: onScroll({ target: $el, enter }),
          });
        }

        /* Grouped reveals (value cards, pricing plans): children cascade. */
        for (const $group of utils.$("[data-reveal-group]")) {
          if (!belowFold($group)) continue;
          const children = Array.from($group.children);
          utils.set(children, { opacity: 0, y: "2.25rem" });
          animate(children, {
            opacity: 1,
            y: 0,
            duration: 800,
            ease: "out(3)",
            delay: stagger(110),
            autoplay: onScroll({ target: $group, enter }),
          });
        }

        /* The marquee rows glide in from the side they scroll toward. */
        for (const $row of utils.$("[data-slide]")) {
          if (!belowFold($row)) continue;
          const from = $row.getAttribute("data-slide") === "right" ? "5rem" : "-5rem";
          utils.set($row, { opacity: 0, x: from });
          animate($row, {
            opacity: 1,
            x: 0,
            duration: 950,
            ease: "out(3)",
            autoplay: onScroll({ target: $row, enter }),
          });
        }

        /* Catalogue numbers count up once their sentence scrolls in. */
        for (const $counter of utils.$("[data-count-to]")) {
          const target = Number($counter.getAttribute("data-count-to"));
          if (!Number.isFinite(target)) continue;
          animate($counter, {
            innerHTML: [0, target],
            modifier: utils.round(0),
            duration: 1400,
            ease: "out(3)",
            autoplay: onScroll({ target: $counter, enter: "bottom-=4% top" }),
          });
        }

        /* Ticker: hand the loop to the scroll position — the strip scrubs as
           the reader passes it, half a track width over the full traversal,
           softened so it eases after the wheel stops. */
        const [$tickerTrack] = utils.$("[data-ticker-track]");
        if ($tickerTrack) {
          animate($tickerTrack, {
            x: "-50%",
            ease: "linear",
            autoplay: onScroll({
              target: $tickerTrack.parentElement ?? $tickerTrack,
              enter: "bottom top",
              leave: "top bottom",
              sync: 0.25,
            }),
          });
        }

        /* Hero phone: a slow breathing float on the wrapper plus a cursor
           tilt on the frame. Split across two elements so the loop and the
           follow never write the same transform. */
        const [$previewWrap] = utils.$("[data-phone-wrap]");
        const [$frame] = utils.$("[data-phone-frame]");
        if ($previewWrap && $frame) {
          animate($previewWrap, {
            y: [-4, 6],
            duration: 4500,
            ease: "inOut(2)",
            alternate: true,
            loop: true,
          });

          const tilt = createAnimatable($frame, { rotateX: 450, rotateY: 450, ease: "out(3)" });
          const onPointerMove = (event: Event) => {
            const pointer = event as PointerEvent;
            const bounds = $previewWrap.getBoundingClientRect();
            const ratioX = utils.clamp((pointer.clientX - bounds.left) / bounds.width, 0, 1);
            const ratioY = utils.clamp((pointer.clientY - bounds.top) / bounds.height, 0, 1);
            tilt.rotateY((ratioX - 0.5) * 10);
            tilt.rotateX((0.5 - ratioY) * 8);
          };
          const onPointerLeave = () => {
            tilt.rotateX(0);
            tilt.rotateY(0);
          };
          $previewWrap.addEventListener("pointermove", onPointerMove);
          $previewWrap.addEventListener("pointerleave", onPointerLeave);
        }

        /* Magnetic primary CTA: leans a few pixels toward the cursor and
           springs back to rest on leave. */
        const [$magnetic] = utils.$("[data-magnetic]");
        if ($magnetic) {
          const magnet = createAnimatable($magnetic, { x: 350, y: 350, ease: "out(3)" });
          const onMagnetMove = (event: Event) => {
            const pointer = event as PointerEvent;
            const bounds = $magnetic.getBoundingClientRect();
            magnet.x(utils.clamp((pointer.clientX - bounds.left - bounds.width / 2) * 0.2, -6, 6));
            magnet.y(utils.clamp((pointer.clientY - bounds.top - bounds.height / 2) * 0.3, -5, 5));
          };
          const onMagnetLeave = () => {
            magnet.x(0);
            magnet.y(0);
          };
          $magnetic.addEventListener("pointermove", onMagnetMove);
          $magnetic.addEventListener("pointerleave", onMagnetLeave);
        }
      });
    })();

    return () => {
      disposed = true;
      delete root.dataset.motionActive;
      scope?.revert();
    };
  }, []);

  return null;
}
