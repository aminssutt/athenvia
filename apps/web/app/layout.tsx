import "@athenvia/ui/tokens.css";
import "./globals.css";

import type { Metadata, Viewport } from "next";

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
      <body>{children}</body>
    </html>
  );
}
