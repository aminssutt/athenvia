import Link from "next/link";

import { Brand } from "@/components/brand";

export const metadata = {
  title: "You are offline",
};

export default function OfflinePage() {
  return (
    <main className="shell offline-shell">
      <Brand />
      <section className="offline-card">
        <span className="offline-mark" aria-hidden="true">
          !
        </span>
        <div>
          <p className="eyebrow">No connection</p>
          <h1>You are offline right now.</h1>
          <p className="muted">
            Check your connection and try again. Programs you already opened may still be available.
          </p>
        </div>
        <Link className="primary-button" href="/home">
          Try again
        </Link>
      </section>
    </main>
  );
}
