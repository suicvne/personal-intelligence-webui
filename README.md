# Intel web UI

A browser client for [intel](../personal-intelligence), alongside the [SwiftUI app](../personal-intelligence-swiftui).
It has the same eight screens, the same corrections, and the same words, with a look of its own. Both talk to
the same intel, so a proposal approved in one is gone from the other after a refresh.

```
Brief · Activity · Proposals · Tasks · Goals · Entities · Ask · Sources · Settings
```

## Running it

You need Node 24 or newer. intel must be running (`intel service install`, or `intel api serve`).

```bash
npm install
npm run build && npm start          # http://127.0.0.1:8766
npm run dev                         # the same, from source, with hot reload
```

The first time, Settings opens. Press **Use the token of the intel on this Mac**, or paste the output of
`intel api token`. The token is kept in this browser's local storage.

Options for `node server/main.ts` (or `npm start -- …`):

| Option | Default | |
|---|---|---|
| `--port N` | 8766 (`$INTEL_WEBUI_PORT`) | where the web UI listens, on 127.0.0.1 only |
| `--intel-url URL` | http://127.0.0.1:8765 (`$INTEL_URL`) | intel's API |
| `--dev` | | serve the source through Vite, with hot reload |
| `--open` | | open the web UI in the browser once it's listening |
| `--no-local-token` | | don't offer to read the token with `intel api token` |

## Why there's a small server

intel's API doesn't answer CORS preflights, and it serves no pages. A browser also can't open a local note,
choose a folder, or run `intel api token`. So `server/` is a small companion with no dependencies. It runs
on one port and one origin, and it does four things:

- **Serves the UI**: `dist/`, or Vite in `--dev`.
- **Passes `/api/*` through to intel.** The browser sends its own token; the companion never adds one.
  - Request bodies are forwarded with a `Content-Length`, because intel reads them no other way.
  - Responses stream through unbuffered. Closing the tab, or pressing Stop, closes intel's connection too, which stops the model or the voice.
  - A quiet answer gets a keep-alive comment between events.
- **Adds `/local/*`**, the things a page can't do:
  - read the token (`intel api token`);
  - open a note or folder (`open`). Apps and scripts are only shown in Finder;
  - choose a folder (the macOS chooser);
  - sync with a heartbeat (`/local/sync`). intel's sync can be silent for over five minutes, which some browsers won't wait for.
- **Keeps other web pages out.**
  - It answers only to `127.0.0.1` and `localhost` (which it redirects), so DNS rebinding can't reach it.
  - `/local/*` also needs a custom header and a same-origin request.
  - Processes on this Mac are trusted, as they are by intel: they could run `intel api token` themselves.

## Compared with the SwiftUI app

The features, the copy, and the rules for each screen are ported from the SwiftUI app. Each screen's file
names its Swift counterpart's behaviour in its header comment. Some things differ because this is a web page:

- **Links.**
  - Every selection and filter is in the URL (`/proposals/12`, `/entities/45?type=component`, `/activity?layer=source`), so you can reload, go back, and link to them.
  - Citations in an answer (`[R1, E2]`) link to their references.
- **Keyboard.** The browser keeps ⌘R and ⇧⌘S, so these use single keys when you're not typing (`?` lists them all):
  - `r` reload, `S` sync now, `1`–`8` switch screens, `,` Settings;
  - `/` search, `j` and `k` move through the list;
  - ⌘↩ approve and ⌘⌫ reject on a proposal, Esc stops an answer.
- **Badges.** The sidebar's counts refresh every minute while the page is visible. (The Mac app refreshes them when you act.)
- **Narrow windows.** The sidebar narrows to icons, then slides in. The list and the selection take turns.
- **intel's address** is set when the companion starts (`--intel-url`), not in Settings.
- **Opening files** only works on macOS. Elsewhere, Open copies the path.
- **Read aloud** plays intel's streamed WAV through the Web Audio API, as it arrives. Browsers only allow sound after a click or a key press, so the first answer read aloud must be asked with one.

## Layout

```
server/            the companion (TypeScript that Node runs as it is; no build step)
  main.ts            options, then listen
  companion.ts       routing, security headers
  guards.ts          who may call
  proxy.ts           /api/* to intel; event_stream_keepalive.ts
  local_routes.ts    /local/*; intel_cli.ts, opener.ts, long_call.ts
  static_files.ts    dist/ and the Content-Security-Policy; dev_vite.ts for --dev
src/
  api/             the client: one method per route (intel_client.ts), models.ts, intel_error.ts,
                   server_sent_events.ts, wav_stream.ts, companion.ts
  lib/             formatting.ts, activity_feed.ts (day sections, folded runs), text.ts
  state/           app_model.ts (status, banner, refresh), router.ts, shortcuts.ts, speech_player.ts,
                   preferences.ts
  ui/              the shell, sheets, menus, cards, badges, controls
  screens/         one file per screen, plus its sheets
  styles/          tokens.css (colors from the app icon), base.css, layout.css, screens.css
tests/             vitest; samples/ are real intel responses; companion/ tests the server; fake_intel.ts
scripts/           snapshots.ts, e2e.ts, live_check.ts, refresh_samples.sh
```

## Checking it

```bash
npm run check          # type-check the UI and the companion
npm test               # unit tests: the client against real samples, SSE, WAV, feed folding, formatting,
                       #   the app model, and the companion against a fake HTTP/1.0 intel
npm run e2e            # drive the main flows in headless Chromium against the fake intel, checking the
                       #   requests each sends (npm run build && npm run e2e -- --built: the built UI)
npm run snapshots      # screenshots of every screen and dialog into snapshots/ (--dark, --width 390, --only …)
npm run live-check     # read every read-only route of your running intel (prints counts only)
npm run fake-intel     # a stand-in intel answering from tests/samples (token "fake-token"); then
                       #   node server/main.ts --dev --intel-url http://127.0.0.1:8775
```

`e2e` and `snapshots` need Playwright's Chromium once: `npx playwright install chromium`.

The samples come from personal-intelligence's test suite (a fake world, never your data), as the SwiftUI
app's do. After changing intel's API, refresh them with `npm run samples`.

## Conventions

These are the same as the other two repos:
- PascalCase for functions and methods (`IntelClient.Proposals()`, `RelativeAge()`);
- snake_case file names;
- camelCase variables and properties.

What something else requires keeps its own form: React hooks (`useTask`), and intel's JSON fields, which
stay snake_case (`last_success_at`) because several are dictionaries keyed by data.
