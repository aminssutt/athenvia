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
    <html lang="en">
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
            window.location.replace("/home");
          }`}
        </Script>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
