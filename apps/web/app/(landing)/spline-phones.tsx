"use client";

import type { Application } from "@splinetool/runtime";
import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";

import styles from "./landing.module.css";

/* The runtime is ~1 MB of lazy JavaScript, so it must never ride in the
   route's first load: ssr:false keeps it out of the server render AND out of
   the landing's First Load JS chunk (perf budget, #102). */
const Spline = dynamic(() => import("@splinetool/react-spline"), { ssr: false });

/* Scene + screen contents are self-hosted: no request ever leaves our origin,
   and a Spline CDN outage cannot break the hero. */
const SCENE_URL = "/marketing/dual-iphones.splinecode";
const SCREEN_TEXTURES = ["/marketing/screen-search.png", "/marketing/screen-program.png"];

/* Structural view of the runtime's material layer — only what we touch. */
type TextureLayer = { type: string; updateTexture?: (src: string) => Promise<void> };

type SplinePhonesProps = {
  /** Static phone mock rendered until (or instead of) the 3D scene. */
  fallback: ReactNode;
};

/**
 * The hero's 3D product shot: two floating iPhones whose screens are swapped
 * at load time for real captures of the app (search results and a program
 * page), so the phones always show the product as it actually ships.
 *
 * The static fallback stays authoritative whenever the scene would cost more
 * than it gives: no JavaScript, reduced motion, phone-sized viewports (the
 * runtime is heavy and the CSS mock reads better small), WebGL failures, and
 * every frame until the scene has finished loading its textures.
 */
export function SplinePhones({ fallback }: SplinePhonesProps) {
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    const wantsMotion = window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
    const wideEnough = window.matchMedia("(min-width: 48rem)").matches;
    setEnabled(wantsMotion && wideEnough);
  }, []);

  async function handleLoad(app: Application) {
    try {
      app.setBackgroundColor("#fbf8f4");
      const screens = app.getAllObjects().filter((object) => object.name === "Screen");
      await Promise.all(
        screens.map((screen, index) => {
          const layers = (screen.material?.layers ?? []) as TextureLayer[];
          const textureLayer = layers.find((layer) => layer.type === "texture");
          return textureLayer?.updateTexture?.(SCREEN_TEXTURES[index % SCREEN_TEXTURES.length]);
        }),
      );
    } catch {
      // The scene still renders with its baked screens; better than no phone.
    }
    setPhase("ready");
  }

  if (!enabled || phase === "failed") {
    return <>{fallback}</>;
  }

  return (
    <div className={styles.splineStage} data-phase={phase}>
      {/* The mock holds the layout (and the eye) until the scene is ready,
          then cross-fades out underneath the canvas. */}
      <div className={styles.splineFallback}>{fallback}</div>
      <div className={styles.splineCanvas} aria-hidden="true">
        <Spline scene={SCENE_URL} onLoad={handleLoad} onError={() => setPhase("failed")} />
      </div>
    </div>
  );
}
