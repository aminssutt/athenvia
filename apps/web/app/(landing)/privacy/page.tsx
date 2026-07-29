import { Brand } from "@/components/brand";

export const metadata = {
  title: "Privacy",
};

export default function PrivacyPage() {
  return (
    <main className="shell">
      <Brand />
      <section className="hero">
        <span className="eyebrow">Privacy</span>
        <h1>Your plans stay yours.</h1>
        <p>
          Athenvia keeps personal watchlists, notes, notification preferences and push subscriptions
          private. We collect only what is required to provide the service and do not sell personal
          data.
        </p>
      </section>
    </main>
  );
}
