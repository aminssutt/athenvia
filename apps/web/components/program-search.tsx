"use client";

import { SearchResponseSchema, type ProgramSummary } from "@athenvia/contracts";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { EmptyState, ErrorState, LoadingState } from "./interface-state";
import { ProgramCard } from "./program-card";
import styles from "./program-search.module.css";

type SearchState =
  | { name: "idle" }
  | { name: "loading"; query: string }
  | { name: "success"; query: string; programs: ProgramSummary[] }
  | { name: "error"; query: string; message: string };

const SEARCH_EXAMPLES = ["NUS", "National University of Singapore", "MSc Venture Creation"];

function getErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if ("message" in payload && typeof payload.message === "string") {
    return payload.message;
  }

  if (
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }

  return null;
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M5 12h14m-5-5 5 5-5 5" />
    </svg>
  );
}

export function ProgramSearch() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ name: "idle" });
  const abortController = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => abortController.current?.abort();
  }, []);

  async function search(rawQuery: string) {
    const normalizedQuery = rawQuery.trim();

    if (normalizedQuery.length < 2) {
      setState({
        name: "error",
        query: normalizedQuery,
        message: "Enter at least two characters to search.",
      });
      inputRef.current?.focus();
      return;
    }

    abortController.current?.abort();
    const requestController = new AbortController();
    abortController.current = requestController;
    setState({ name: "loading", query: normalizedQuery });

    try {
      const response = await fetch(`/api/search?query=${encodeURIComponent(normalizedQuery)}`, {
        headers: { Accept: "application/json" },
        signal: requestController.signal,
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getErrorMessage(payload) ?? "Search is unavailable right now.");
      }

      const parsedResponse = SearchResponseSchema.safeParse(payload);

      if (!parsedResponse.success) {
        throw new Error("Search returned an unexpected response. Please try again.");
      }

      setState({
        name: "success",
        query: normalizedQuery,
        programs: parsedResponse.data.programs,
      });
    } catch (error) {
      if (requestController.signal.aborted) {
        return;
      }

      setState({
        name: "error",
        query: normalizedQuery,
        message: error instanceof Error ? error.message : "Search is unavailable right now.",
      });
    } finally {
      if (abortController.current === requestController) {
        abortController.current = null;
      }
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void search(query);
  }

  function searchExample(example: string) {
    setQuery(example);
    void search(example);
  }

  function clearSearch() {
    abortController.current?.abort();
    abortController.current = null;
    setQuery("");
    setState({ name: "idle" });
    inputRef.current?.focus();
  }

  const isLoading = state.name === "loading";
  const hasResults = state.name === "success" && state.programs.length > 0;
  const isEmpty = state.name === "success" && state.programs.length === 0;

  return (
    <section className={styles.search} aria-labelledby="search-form-title">
      <h2 className={styles.visuallyHidden} id="search-form-title">
        Search universities and programs
      </h2>

      <form className={styles.form} role="search" noValidate onSubmit={submitSearch}>
        <label className={styles.label} htmlFor="program-search">
          University or program
        </label>
        <div className={styles.inputRow}>
          <span className={styles.searchIcon}>
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            aria-describedby="search-help"
            autoCapitalize="none"
            autoComplete="off"
            enterKeyHint="search"
            id="program-search"
            inputMode="search"
            maxLength={120}
            minLength={2}
            name="query"
            placeholder="Try NUS or MSc Venture Creation"
            spellCheck={false}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button className={styles.clearButton} type="button" onClick={clearSearch}>
              <span aria-hidden="true">×</span>
              <span className={styles.visuallyHidden}>Clear search</span>
            </button>
          ) : null}
          <button className={styles.submitButton} disabled={isLoading} type="submit">
            {isLoading ? "Searching…" : "Search"}
          </button>
        </div>
        <p className={styles.help} id="search-help">
          Names and familiar aliases both work.
        </p>
      </form>

      <div aria-live="polite" aria-atomic="true" className={styles.visuallyHidden}>
        {isLoading ? `Searching for ${state.query}` : null}
        {hasResults
          ? `${state.programs.length} ${state.programs.length === 1 ? "program" : "programs"} found`
          : null}
        {isEmpty ? `No programs found for ${state.query}` : null}
      </div>

      {state.name === "idle" ? (
        <div className={styles.suggestions}>
          <p>Try searching for</p>
          <div className={styles.suggestionList}>
            {SEARCH_EXAMPLES.map((example) => (
              <button key={example} type="button" onClick={() => searchExample(example)}>
                <span>{example}</span>
                <ArrowIcon />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className={styles.statePanel}>
          <LoadingState
            description={`Looking for programs matching ${state.query}.`}
            title="Searching programs"
          />
        </div>
      ) : null}

      {hasResults ? (
        <div className={styles.results}>
          <div className={styles.resultsHeading}>
            <h2>Programs</h2>
            <span>
              {state.programs.length} {state.programs.length === 1 ? "result" : "results"}
            </span>
          </div>
          <ul>
            {state.programs.map((program) => (
              <li key={program.id}>
                <ProgramCard href={`/programs/${program.id}`} locale="en" program={program} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {isEmpty ? (
        <div className={styles.statePanel}>
          <EmptyState
            action={
              <button type="button" onClick={clearSearch}>
                Try another search
              </button>
            }
            description={`We couldn’t find anything for “${state.query}”. Try a full university name, an alias, or the program title.`}
            title="No programs found"
          />
        </div>
      ) : null}

      {state.name === "error" ? (
        <div className={styles.statePanel}>
          <ErrorState
            description={state.message}
            onRetry={() =>
              state.query.length >= 2 ? void search(state.query) : inputRef.current?.focus()
            }
            retryLabel={state.query.length >= 2 ? "Try again" : "Review search"}
            title="We couldn’t complete that search"
          />
        </div>
      ) : null}
    </section>
  );
}
