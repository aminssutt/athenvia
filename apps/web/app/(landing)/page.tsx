import Link from "next/link";

import { Brand } from "@/components/brand";
import { StandaloneRedirect } from "@/components/standalone-redirect";

export default function LandingPage() {
  return (
    <main className="shell">
      <StandaloneRedirect />
      <Brand />

      <section className="hero">
        <span className="eyebrow">Your path to what’s next</span>
        <h1>Never miss an application date.</h1>
        <p>
          Follow the programs that matter to you and get reminded before applications open or close.
        </p>
        <a className="primary-button" href="#install">
          Install Athenvia
        </a>
      </section>

      <section className="preview" aria-label="Athenvia app preview">
        <div className="preview-top">
          <div className="card-row">
            <span className="university-mark" aria-hidden="true">
              N
            </span>
            <div>
              <strong>MSc Venture Creation</strong>
              <div className="muted">National University of Singapore</div>
            </div>
          </div>
        </div>
        <p className="status">Not published yet</p>
      </section>

      <section className="install-card" id="install">
        <span className="eyebrow">Install on iPhone</span>
        <h2>Keep Athenvia on your Home Screen.</h2>
        <ol className="steps">
          <li>Tap the Safari share button.</li>
          <li>
            Choose <strong>Add to Home Screen</strong>.
          </li>
          <li>Open Athenvia from the new icon.</li>
        </ol>
      </section>

      <footer className="landing-footer">
        <Link href="/privacy">Privacy</Link>
      </footer>
    </main>
  );
}
