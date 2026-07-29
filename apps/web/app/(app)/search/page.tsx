import type { Metadata } from "next";

import { Brand } from "@/components/brand";
import { MobileNavigation } from "@/components/mobile-navigation";
import { ProgramSearch } from "@/components/program-search";

import styles from "./search.module.css";

export const metadata: Metadata = {
  title: "Search programs",
  description: "Search universities and programs to follow on Athenvia.",
};

export default function SearchPage() {
  return (
    <div className={styles.appFrame}>
      <main className={styles.page}>
        <header className={styles.header}>
          <Brand />
          <div className={styles.heading}>
            <p>Find your next program</p>
            <h1>Search</h1>
            <span>Use a university name, a familiar alias, or the program itself.</span>
          </div>
        </header>

        <ProgramSearch />
      </main>
      <MobileNavigation />
    </div>
  );
}
