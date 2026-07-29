"use client";

import { useEffect } from "react";

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

const STANDALONE_MEDIA_QUERY = "(display-mode: standalone)";

function isIosStandalone(navigator: Navigator): boolean {
  return (navigator as NavigatorWithStandalone).standalone === true;
}

export function StandaloneRedirect() {
  useEffect(() => {
    const displayMode =
      typeof window.matchMedia === "function" ? window.matchMedia(STANDALONE_MEDIA_QUERY) : null;

    const openInstalledApp = () => {
      if (displayMode?.matches || isIosStandalone(window.navigator)) {
        window.location.replace("/home");
      }
    };

    openInstalledApp();
    if (typeof displayMode?.addEventListener === "function") {
      displayMode.addEventListener("change", openInstalledApp);
    } else {
      displayMode?.addListener(openInstalledApp);
    }

    return () => {
      if (typeof displayMode?.removeEventListener === "function") {
        displayMode.removeEventListener("change", openInstalledApp);
      } else {
        displayMode?.removeListener(openInstalledApp);
      }
    };
  }, []);

  return null;
}
