import { publicDateCopy } from "@athenvia/contracts";
import { mockWatchlistResponse } from "@athenvia/contracts/mocks";

import { Brand } from "@/components/brand";

export const metadata = {
  title: "My programs",
};

export default function HomePage() {
  const [watchingItem] = mockWatchlistResponse.watching;

  return (
    <main className="shell">
      <header className="app-header">
        <Brand />
        <h1>Your programs</h1>
        <p className="muted">The next useful dates, without the noise.</p>
      </header>

      <section className="section">
        <div className="section-heading">
          <h2>Watching</h2>
          <span>{mockWatchlistResponse.watching.length}</span>
        </div>
        {watchingItem ? (
          <article className="card">
            <div className="card-row">
              <span className="university-mark" aria-hidden="true">
                {watchingItem.program.university.name.charAt(0)}
              </span>
              <div>
                <h3>{watchingItem.program.name}</h3>
                <p>{watchingItem.program.university.name}</p>
              </div>
            </div>
            <span className="status">
              {
                publicDateCopy[watchingItem.program.nextWindow?.publicStatus ?? "NOT_PUBLISHED"]
                  .title
              }
            </span>
          </article>
        ) : (
          <div className="empty-card">Add a program to start watching it.</div>
        )}
      </section>

      <section className="section">
        <div className="section-heading">
          <h2>Open now</h2>
          <span>{mockWatchlistResponse.openNow.length}</span>
        </div>
        <div className="empty-card">Nothing is open right now.</div>
      </section>

      <section className="section">
        <div className="section-heading">
          <h2>Applied</h2>
          <span>{mockWatchlistResponse.applied.length}</span>
        </div>
        <div className="empty-card">Programs you mark as submitted will appear here.</div>
      </section>
    </main>
  );
}
