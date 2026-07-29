"use client";

import { useEffect } from "react";

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

const STANDALONE_MEDIA_QUERY = "(display-mode: standalone)";
const ONBOARDING_STORAGE_KEY = "athenvia:onboarding:v1";

function isIosStandalone(navigator: Navigator): boolean {
  return (navigator as NavigatorWithStandalone).standalone === true;
}

function installedStartPath(storage: Storage): "/home" | "/onboarding" {
  try {
    const serialized = storage.getItem(ONBOARDING_STORAGE_KEY);
    if (!serialized) {
      return "/onboarding";
    }

    const onboarding: unknown = JSON.parse(serialized);
    if (
      onboarding &&
      typeof onboarding === "object" &&
      "completed" in onboarding &&
      onboarding.completed === true &&
      "version" in onboarding &&
      onboarding.version === 1
    ) {
      return "/home";
    }

    return "/onboarding";
  } catch {
    // If device storage is unavailable, avoid trapping the user in onboarding.
    return "/home";
  }
}

export function StandaloneRedirect() {
  useEffect(() => {
    const displayMode =
      typeof window.matchMedia === "function" ? window.matchMedia(STANDALONE_MEDIA_QUERY) : null;

    const openInstalledApp = () => {
      if (displayMode?.matches || isIosStandalone(window.navigator)) {
        window.location.replace(installedStartPath(window.localStorage));
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
