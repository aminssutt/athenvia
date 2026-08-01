import "@athenvia/ui/tokens.css";
import "./globals.css";

import type { Metadata, Viewport } from "next";
import Script from "next/script";

import { ServiceWorkerRegistration } from "@/components/service-worker-registration";

export const metadata: Metadata = {
  title: {
    default: "Athenvia",
    template: "%s · Athenvia",
  },
  description: "Follow university programs and get reminded before applications open or close.",
  applicationName: "Athenvia",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Athenvia",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#FBF8F4",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // data-scroll-behavior opts into Next's handling of CSS smooth scrolling
    // during route transitions (globals.css sets it on <html>).
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <Script id="standalone-route-gate" strategy="beforeInteractive">
          {`if (
            window.location.pathname === "/" &&
            (
              (typeof window.matchMedia === "function" &&
                window.matchMedia("(display-mode: standalone)").matches) ||
              window.navigator.standalone === true
            )
          ) {
            var nextPath = "/home";
            try {
              var serializedOnboarding = window.localStorage.getItem("athenvia:onboarding:v1");
              var onboarding = serializedOnboarding ? JSON.parse(serializedOnboarding) : null;
              if (!onboarding || onboarding.completed !== true || onboarding.version !== 1) {
                nextPath = "/onboarding";
              }
            } catch {
              // Storage can be unavailable in strict privacy modes; the app remains reachable.
            }
            window.location.replace(nextPath);
          }`}
        </Script>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
