import Link from "next/link";

import { Brand } from "@/components/brand";

export const metadata = {
  title: "Check your email",
};

export default function CheckEmailPage() {
  return (
    <main className="shell auth-shell">
      <Brand />
      <section className="auth-card" aria-labelledby="check-email-title">
        <span className="auth-mail-mark" aria-hidden="true">
          ✓
        </span>
        <div>
          <p className="eyebrow">Email sent</p>
          <h1 id="check-email-title">Check your inbox.</h1>
          <p className="muted">
            If that address can receive email, a sign-in link is on its way. It expires in 15
            minutes and works once.
          </p>
        </div>
        <Link className="primary-button" href="/home">
          Back to Athenvia
        </Link>
      </section>
    </main>
  );
}
