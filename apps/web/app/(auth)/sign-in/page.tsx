import Link from "next/link";

import { Brand } from "@/components/brand";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { MagicLinkForm } from "@/components/magic-link-form";
import { resolveGoogleAuthConfiguration } from "@/lib/auth-config";

export const metadata = {
  title: "Sign in",
};

export const dynamic = "force-dynamic";

export default function SignInPage() {
  const googleAuthEnabled = resolveGoogleAuthConfiguration() !== null;

  return (
    <main className="shell auth-shell">
      <Brand />
      <section className="auth-card" aria-labelledby="sign-in-title">
        <p className="eyebrow">Sign in</p>
        <h1 id="sign-in-title">Keep your programs with you.</h1>
        <p className="muted">
          {googleAuthEnabled
            ? "Use Google, or receive a secure sign-in link by email. No password required."
            : "We will email you a secure link. No password and no long registration form."}
        </p>
        {googleAuthEnabled ? (
          <>
            <GoogleSignInButton />
            <div className="auth-divider" aria-hidden="true">
              <span>or continue with email</span>
            </div>
          </>
        ) : null}
        <MagicLinkForm />
        <p className="auth-note">
          Anything you chose before signing in stays on this device.{" "}
          <Link href="/home">Continue without an account</Link>.
        </p>
      </section>
    </main>
  );
}
