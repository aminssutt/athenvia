"use client";

import { useEffect } from "react";

export function StandaloneRedirect() {
  useEffect(() => {
    const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      navigatorWithStandalone.standalone === true;

    if (standalone) {
      window.location.replace("/home");
    }
  }, []);

  return null;
}
