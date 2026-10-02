# v0.4.1 verification

Checked 2026-10-02. Beta qualification: synthetic tests do not certify every current live provider layout. All public fixtures and screenshots use synthetic conversation content.

## Results

| Check | Result | Coverage |
| --- | --- | --- |
| TypeScript | Pass | `npm run check` |
| Node regressions | 77 pass | Provider adapters, inspection retries, navigation guards, capture sessions, download completion/failure/cancellation, PDF worker cancellation, PDF/Markdown rendering, embedded fonts, packaged licenses, toolbar routing |
| Browser capture | 27 pass | Static and virtualized ChatGPT/Gemini fixtures, delayed history, repeated/updated messages, continuity gaps, duplicate IDs, stalls, timeout, navigation, cancellation, restored scrolling |
| ChatGPT compatibility | 7 pass | Legacy and newer role markers, prompt buttons, keyed div/list wrappers, ordered content and stable IDs |
| Scroll constraints | 17 pass | Native snapping, negative column-reverse ranges, shrinking endpoints, semantic transcript bounds, declared virtual canvases, incomplete-layout rejection, quiet intervals, exact scroll/style restoration |
| Extension integration | 5 pass | Real injection into synthetic pages, delayed hydration, Blob downloads, retained captures, worker-rendered PDF, light/dark preview, responsive controls, owner cleanup |
| Native side panel | 3 pass | Actual `SIDE_PANEL` document, correct source tab, PDF/Markdown downloads with all 12 ordered fixture anchors, completion confirmation, restored scroll, unchanged source URL and ordinary tab count |

Browser checks use isolated profiles and synthetic pages. Extension tests add host grants only to disposable copies; the production manifest uses `activeTab`, `scripting`, `downloads`, and `sidePanel`, with no permanent host permissions. Native-panel tests use a trusted extension-frame gesture; they do not independently prove toolbar `activeTab` granting on every live account.

PDF raster checks cover bold headings and emphasis, code, tables, both palettes, and Chinese fallback glyphs. Inter Regular/Bold are fully embedded with ligatures disabled; text extraction retains character sequences. The native-panel PDF contains all 12 fixture anchors in order across two pages. Full dependency and font license texts are included in the build.

## Reproduce

```sh
npm ci
npm run check
npm test
```

Browser suites additionally require Playwright and compatible Chromium. `PLAYWRIGHT_MODULE` can identify an existing Playwright installation. `PLAYWRIGHT_EXECUTABLE` must identify a Chromium binary supporting unpacked extensions for the extension and side-panel suites.

```sh
node tests/capture-browser.mjs
node tests/chatgpt-compat-browser.mjs
node tests/capture-scroll-browser.mjs
node tests/extension-browser.mjs
node tests/side-panel-browser.mjs
```

Generated QA files stay under ignored `output/`; they are not part of the source release.

## Live-provider limits

A manual ChatGPT export was reported successful. Its format and complete contents were not independently verified. Long live ChatGPT conversations, Gemini, and other current provider layouts still need separate qualification.

Settled loaded boundaries and continuity checks provide DOM evidence, not authoritative server history completeness. Hidden branches, collapsed artifacts, attachments, and history that never mounts are not proven included. Unsupported geometry fails explicitly instead of returning a detected partial transcript.

For a live qualification check, start midway through a long conversation. Compare known first, middle, and last messages and their order in both exported formats. Check cancellation, cancelled saves, retries, and failure reporting. Keep private conversations out of public fixtures, screenshots, and issues.
