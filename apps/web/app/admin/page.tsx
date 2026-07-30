import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Brand } from "@/components/brand";
import { listPendingAdminReviews } from "@/app/api/admin/reviews/service";
import { resolveAdminAccess } from "@/app/api/admin/reviews/security";

import { ReviewQueue } from "./review-queue";
import styles from "./review.module.css";

export const metadata: Metadata = {
  title: "Review queue",
  description: "Review Athenvia catalogue evidence and proposed changes.",
};

export default async function AdminReviewPage() {
  const access = await resolveAdminAccess();
  if (access.status === "UNAUTHENTICATED") {
    redirect("/sign-in?callbackUrl=%2Fadmin");
  }
  if (access.status === "FORBIDDEN") {
    notFound();
  }
  const reviews = await listPendingAdminReviews();

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Brand />
        <p className={styles.eyebrow}>Restricted workspace</p>
        <h1>Review queue</h1>
        <p>Compare each proposed value with its evidence before making a decision.</p>
      </header>
      <ReviewQueue initialReviews={reviews} />
    </main>
  );
}
