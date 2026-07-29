import Link from "next/link";

import { Brand } from "@/components/brand";
import { MagicLinkForm } from "@/components/magic-link-form";

export const metadata = {
  title: "Sign in",
};

export default function SignInPage() {
  return (
    <main className="shell auth-shell">
      <Brand />
      <section className="auth-card" aria-labelledby="sign-in-title">
        <p className="eyebrow">Sign in</p>
        <h1 id="sign-in-title">Keep your programs with you.</h1>
        <p className="muted">
          We will email you a secure link. No password and no long registration form.
        </p>
        <MagicLinkForm />
        <p className="auth-note">
          Anything you chose before signing in stays on this device.{" "}
          <Link href="/home">Continue without an account</Link>.
        </p>
      </section>
    </main>
  );
}
