# Athenvia web

## Standalone-mode gate

The public `/` route remains the installation landing page in mobile Safari, desktop browsers and
browsers that do not support display-mode detection.

An installed launch is detected using either:

- the standards-based `(display-mode: standalone)` media query; or
- `navigator.standalone === true`, retained for iOS Home Screen compatibility.

When either signal is active, the landing route uses `location.replace("/home")`. Replacing the
location keeps the landing page out of the installed app's Back history. The media query is also
observed for changes while the page is open. A small pre-interactive check handles the initial
installed launch before React starts, while CSS hides landing content during standards-based
standalone detection. Together they prevent the installation page from flashing before the redirect
completes.

If neither API is available, Athenvia deliberately leaves the visitor on the landing page. The
application remains directly reachable at `/home`.
