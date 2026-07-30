/* global self, URL */

((scope) => {
  const programPathPattern =
    /^\/programs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

  function safeProgramDeepLink(value) {
    if (typeof value !== "string" || value.includes("\\") || !programPathPattern.test(value)) {
      return null;
    }
    let url;
    try {
      url = new URL(value, scope.location.origin);
    } catch {
      return null;
    }
    if (
      url.origin !== scope.location.origin ||
      url.pathname !== value ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return null;
    }
    return url.pathname;
  }

  function safePushPayload(event) {
    if (!event.data) {
      return null;
    }
    let value;
    try {
      value = event.data.json();
    } catch {
      return null;
    }
    const deepLink = safeProgramDeepLink(value?.deepLink);
    if (
      deepLink === null ||
      typeof value?.title !== "string" ||
      value.title.length < 1 ||
      value.title.length > 120 ||
      typeof value?.body !== "string" ||
      value.body.length < 1 ||
      value.body.length > 240 ||
      typeof value?.dedupeKey !== "string" ||
      value.dedupeKey.length < 8 ||
      value.dedupeKey.length > 255
    ) {
      return null;
    }
    return {
      body: value.body,
      dedupeKey: value.dedupeKey,
      deepLink,
      title: value.title,
    };
  }

  scope.addEventListener("push", (event) => {
    const payload = safePushPayload(event);
    if (payload === null) {
      return;
    }
    event.waitUntil(
      scope.registration.showNotification(payload.title, {
        badge: "/icons/mark.svg",
        body: payload.body,
        data: { deepLink: payload.deepLink },
        icon: "/icons/icon.svg",
        tag: payload.dedupeKey,
      }),
    );
  });

  scope.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const deepLink = safeProgramDeepLink(event.notification.data?.deepLink);
    if (deepLink === null) {
      return;
    }
    event.waitUntil(
      scope.clients
        .matchAll({ includeUncontrolled: true, type: "window" })
        .then(async (clients) => {
          let sameOriginClient = null;
          for (const client of clients) {
            let clientUrl;
            try {
              clientUrl = new URL(client.url);
            } catch {
              continue;
            }
            if (
              clientUrl.origin === scope.location.origin &&
              clientUrl.pathname === deepLink &&
              clientUrl.search === "" &&
              clientUrl.hash === "" &&
              "focus" in client
            ) {
              return client.focus();
            }
            if (
              sameOriginClient === null &&
              clientUrl.origin === scope.location.origin &&
              "navigate" in client &&
              "focus" in client
            ) {
              sameOriginClient = client;
            }
          }
          if (sameOriginClient !== null) {
            await sameOriginClient.navigate(deepLink);
            return sameOriginClient.focus();
          }
          return scope.clients.openWindow(deepLink);
        }),
    );
  });

  scope.__athenviaNotificationNavigation = Object.freeze({
    safeProgramDeepLink,
  });
})(self);
