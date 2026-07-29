import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Athenvia",
    short_name: "Athenvia",
    description: "Follow programs and never miss an application date.",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    background_color: "#FBF8F4",
    theme_color: "#FBF8F4",
    orientation: "portrait",
    icons: [
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
