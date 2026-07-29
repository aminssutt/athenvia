"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const ONE_HOUR = 60 * 60 * 1000;

export function ServiceWorkerRegistration() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const reloadForUpdate = useRef(false);

  const applyUpdate = useCallback(() => {
    if (!waitingWorker) {
      return;
    }

    reloadForUpdate.current = true;
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  }, [waitingWorker]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
      return;
    }

    let registration: ServiceWorkerRegistration | undefined;
    let updateTimer: ReturnType<typeof setInterval> | undefined;

    const showWaitingWorker = () => {
      if (registration?.waiting) {
        setWaitingWorker(registration.waiting);
      }
    };

    const watchInstallingWorker = () => {
      const installingWorker = registration?.installing;
      if (!installingWorker) {
        return;
      }

      installingWorker.addEventListener("statechange", () => {
        if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
          setWaitingWorker(installingWorker);
        }
      });
    };

    const checkForUpdate = () => {
      if (document.visibilityState === "visible") {
        void registration?.update();
      }
    };

    const handleControllerChange = () => {
      if (reloadForUpdate.current) {
        window.location.reload();
      }
    };

    void navigator.serviceWorker
      .register(
        `/sw.js?v=${encodeURIComponent(
          process.env.NEXT_PUBLIC_ATHENVIA_DEPLOYMENT_ID ?? "development",
        )}`,
        {
          scope: "/",
          updateViaCache: "none",
        },
      )
      .then((registered) => {
        registration = registered;
        showWaitingWorker();
        registration.addEventListener("updatefound", watchInstallingWorker);
        updateTimer = setInterval(checkForUpdate, ONE_HOUR);
        document.addEventListener("visibilitychange", checkForUpdate);
      })
      .catch(() => {
        // Offline support is an enhancement. The app remains usable if registration fails.
      });

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    return () => {
      if (updateTimer) {
        clearInterval(updateTimer);
      }
      registration?.removeEventListener("updatefound", watchInstallingWorker);
      document.removeEventListener("visibilitychange", checkForUpdate);
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);

  if (!waitingWorker) {
    return null;
  }

  return (
    <aside className="update-notice" aria-live="polite" aria-label="Athenvia update available">
      <p>
        <strong>A fresh version is ready.</strong>
        <span>Update when you are ready. Nothing will be lost.</span>
      </p>
      <button type="button" onClick={applyUpdate}>
        Update now
      </button>
    </aside>
  );
}
