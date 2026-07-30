import { readFileSync } from "node:fs";
import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

const PROGRAM_ID = "44444444-4444-4444-8444-444444444444";
const DEEP_LINK = `/programs/${PROGRAM_ID}`;
const source = readFileSync(new URL("../public/sw-notifications.js", import.meta.url), "utf8");

type EventHandler = (event: Record<string, unknown>) => void;

function harness(clients: Array<Record<string, unknown>> = []) {
  const handlers = new Map<string, EventHandler>();
  const openWindow = vi.fn(async () => undefined);
  const showNotification = vi.fn(async () => undefined);
  const scope = {
    addEventListener: (name: string, handler: EventHandler) => {
      handlers.set(name, handler);
    },
    clients: {
      matchAll: vi.fn(async () => clients),
      openWindow,
    },
    location: {
      origin: "https://athenvia.example",
    },
    registration: {
      showNotification,
    },
  };
  vm.runInNewContext(source, { Object, Promise, URL, self: scope });
  return { handlers, openWindow, scope, showNotification };
}

function pushEvent(value: unknown) {
  let completion: Promise<unknown> | undefined;
  return {
    event: {
      data: {
        json: () => value,
      },
      waitUntil: (promise: Promise<unknown>) => {
        completion = promise;
      },
    },
    completion: () => completion,
  };
}

function clickEvent(deepLink: unknown) {
  let completion: Promise<unknown> | undefined;
  const close = vi.fn();
  return {
    close,
    completion: () => completion,
    event: {
      notification: {
        close,
        data: { deepLink },
      },
      waitUntil: (promise: Promise<unknown>) => {
        completion = promise;
      },
    },
  };
}

describe("service-worker push notifications", () => {
  it("shows a minimal notification and uses dedupeKey as its tag", async () => {
    const { handlers, showNotification } = harness();
    const push = pushEvent({
      body: "Applications open soon.",
      dedupeKey: "athenvia:reminder:one",
      deepLink: DEEP_LINK,
      title: "Application opening",
    });
    handlers.get("push")?.(push.event);
    await push.completion();
    expect(showNotification).toHaveBeenCalledWith("Application opening", {
      badge: "/icons/mark.svg",
      body: "Applications open soon.",
      data: { deepLink: DEEP_LINK },
      icon: "/icons/icon.svg",
      tag: "athenvia:reminder:one",
    });
  });

  it("drops malformed or unsafe push payloads", () => {
    const { handlers, showNotification } = harness();
    for (const value of [
      null,
      { body: "Body", dedupeKey: "athenvia:key", deepLink: "https://evil.test", title: "Title" },
      { body: "Body", dedupeKey: "athenvia:key", deepLink: `${DEEP_LINK}?x=1`, title: "Title" },
      { body: "Body", dedupeKey: "athenvia:key", deepLink: `${DEEP_LINK}#x`, title: "Title" },
      { body: "Body", dedupeKey: "athenvia:key", deepLink: "/programs\\evil", title: "Title" },
    ]) {
      handlers.get("push")?.(pushEvent(value).event);
    }
    expect(showNotification).not.toHaveBeenCalled();
  });
});

describe("service-worker notification navigation", () => {
  it("focuses an already-open exact programme window", async () => {
    const focus = vi.fn(async () => undefined);
    const { handlers, openWindow } = harness([
      { focus, url: `https://athenvia.example${DEEP_LINK}` },
    ]);
    const click = clickEvent(DEEP_LINK);
    handlers.get("notificationclick")?.(click.event);
    await click.completion();
    expect(click.close).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("navigates and focuses an existing same-origin window before opening another", async () => {
    const focus = vi.fn(async () => undefined);
    const navigate = vi.fn(async () => undefined);
    const { handlers, openWindow } = harness([
      { focus, navigate, url: "https://athenvia.example/home" },
    ]);
    const click = clickEvent(DEEP_LINK);
    handlers.get("notificationclick")?.(click.event);
    await click.completion();
    expect(navigate).toHaveBeenCalledWith(DEEP_LINK);
    expect(focus).toHaveBeenCalledOnce();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("opens the exact internal programme link when no Athenvia window exists", async () => {
    const { handlers, openWindow } = harness([
      { focus: vi.fn(), url: "https://other.example/home" },
    ]);
    const click = clickEvent(DEEP_LINK);
    handlers.get("notificationclick")?.(click.event);
    await click.completion();
    expect(openWindow).toHaveBeenCalledWith(DEEP_LINK);
  });

  it.each([
    "https://evil.example/programs/44444444-4444-4444-8444-444444444444",
    `${DEEP_LINK}?redirect=https://evil.example`,
    `${DEEP_LINK}#fragment`,
    "/programs\\44444444-4444-4444-8444-444444444444",
    "/programs/not-a-uuid",
  ])("rejects unsafe click navigation: %s", (unsafeLink) => {
    const { handlers, openWindow } = harness();
    const click = clickEvent(unsafeLink);
    handlers.get("notificationclick")?.(click.event);
    expect(click.close).toHaveBeenCalledOnce();
    expect(click.completion()).toBeUndefined();
    expect(openWindow).not.toHaveBeenCalled();
  });
});
