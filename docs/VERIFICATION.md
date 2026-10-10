# v0.4.2 verification

Beta qualification: synthetic tests do not certify every current live provider layout. Public fixtures and screenshots use synthetic conversation content. The scoped live ChatGPT check below includes a completed download and visual inspection.

## Current results

| Check | Result | Coverage |
| --- | --- | --- |
| TypeScript | Pass | `npm run check` |
| Node regressions | 82 pass | Provider adapters, inspection retries, navigation guards, capture sessions, download completion/failure/cancellation, PDF worker cancellation, PDF/Markdown rendering, embedded fonts, packaged licenses, toolbar routing, visual block validation and rendering |
| Browser capture | 27 pass | Static and virtualized ChatGPT/Gemini fixtures, delayed history, repeated/updated messages, continuity gaps, duplicate IDs, stalls, timeout, navigation, cancellation, restored scrolling |
| Scroll constraints | 17 pass | Native snapping, negative column-reverse ranges, shrinking endpoints, semantic transcript bounds, declared virtual canvases, incomplete-layout rejection, quiet intervals, exact scroll/style restoration |
| Capture speed and layout | 7 pass | Reused quiet time with mutation/loading guards, paired user/assistant turn boxes, declared wrapper margins and column flex gaps, unknown spacer traversal, uncovered canvas-tail rejection |
| Rich components | 8 pass | Preview/full PNG capture, component colors/icons/buttons/CJK, PDF raster output, narrow-source readable layout and restoration, reviewed SVG/canvas/transform/border edges, oversized visual pagination, streamed-word animations, intrinsic CJK labels and divider clipping |
| Extension integration | 5 pass | Real injection into synthetic pages, delayed hydration, Blob downloads, retained captures, worker-rendered PDF, light/dark preview, responsive controls, owner cleanup |
| Native side panel | 3 pass | Actual `SIDE_PANEL` document, correct source tab, PDF/Markdown downloads with all 12 ordered fixture anchors, completion confirmation, restored scroll, unchanged source URL and ordinary tab count |

Rich-component checks compare captured PNGs with source pixels. They cover SVG `defs`/`use`, local gradients and clip paths, canvas bitmap contents, child transforms, directional borders, a component that is itself the DIL content root, and an inline component surrounded by paragraph text. Response toolbars stay excluded. Oversized components retain top, middle, and bottom content across pages at readable width.

A synthetic 199 CSS px source viewport is also checked: adaptive components render at 640 px, while the fixed mobile design retains its 390 px maximum width. Capture restores the source DOM, layout, and scroll position. These checks qualify the tested component structures, not every interactive artifact or animation state.

Staged clones disable animations before style capture so streamed words do not restart invisibly. Intrinsically sized DIL text within flex layouts preserves `width: auto` only when Typed OM confirms it; explicit inline and class widths retain their wrapping. Controlled CJK label checks pass at both 820 px and 199 px source widths, with a mean pixel difference of 1.49/255. Divider clipping matches source pixels exactly; the streamed-word fixture differs by 0.78/255. Public fixtures use hand-authored generic test copy, CSS, and vector shapes; private chat wording and screenshot pixels are excluded.

## Previous v0.4.1 evidence

The following suite passed in the 2026-10-02 v0.4.1 validation. It was **not rerun for v0.4.2**.

| Check | Previous result | Coverage |
| --- | --- | --- |
| ChatGPT compatibility | 7 pass | Legacy and newer role markers, prompt buttons, keyed div/list wrappers, ordered content and stable IDs |

Browser checks use isolated profiles and synthetic pages. Extension suites add host grants only to disposable copies; the production manifest uses `activeTab`, `scripting`, `downloads`, and `sidePanel`, with no permanent host permissions. Native-panel tests use a trusted extension-frame gesture; they do not independently prove toolbar `activeTab` granting on every live account.

PDF raster checks cover bold headings and emphasis, code, tables, both palettes, and Chinese fallback glyphs. Inter Regular/Bold are fully embedded with ligatures disabled. The static Unicode fallback also disables localized glyph substitutions and ligatures so mixed Latin/CJK digits, color values, and original character sequences remain searchable. The mixed-text regression failed before this fix and passed afterward; a separate Poppler extraction and raster check also passed. The current isolated native-panel PDF contains all 12 fixture anchors in order. Full dependency and font license texts are included in the build.

## Isolated release-candidate check

On 2026-10-11, a 73-file source allowlist was exported without Git history, personal exports, local plans, agent instructions, caches, or installed dependencies. A clean `npm ci`, TypeScript check, production build, and all 82 Node regressions passed using Node.js 24.19.0. After a final fixture-copy cleanup, all 8 affected Markdown checks passed again.

The isolated candidate also passed 23 browser checks: capture speed (7), rich components (8), extension integration (5), and native side panel (3). Extension and native-panel checks used fresh Chrome for Testing 149.0.7827.55 profiles. Actual synthetic PDF/Markdown downloads retained all 12 fixture anchors; capture reuse after closing the source tab passed. The 44-file production build contains no source maps or private export files. Source and bundle secret scans reported no leaks. The locked dependency audit reported zero vulnerabilities; separately prebundled Fontkit helpers and Unicode data do not expose exact revisions for that audit.

## Scoped performance measurements

These are measured synthetic workloads, not general export-time guarantees.

| Workload | Before | After | Measured change |
| --- | --- | --- | --- |
| Capture: two 4,500 CSS px paired turns, four messages, 467 px viewport, default quiet intervals | 23.257 s; 34 scroll events | 4.128 s; 4 scroll events | 82% faster; identical four messages and order |
| CJK PDF rendering: 5,400 Chinese characters, median of paired runs | 1,200 ms; 11.435 MB PDF | 745 ms; 6.457 MB PDF | About 38% faster rendering and 44% smaller PDF |

The capture improvement recognizes already mounted turn boxes and their declared wrapper spacing instead of traversing each viewport. A real boundary movement still receives the full two-second quiet interval; loading and intervening DOM mutations invalidate reused quiet time. Unknown spacer geometry takes the normal scan path, and uncovered declared canvas tails still fail without returning a partial transcript.

## Scoped live ChatGPT observation

On the same live four-message conversation, the earlier export attempt took more than 90 seconds. With the rebuilt extension, capture and rendering reached the native Save dialog in under nine seconds. This measures progress through the Save dialog for that chat, excluding time spent choosing a destination.

The first save attempts were interrupted while host free space was below 500 MiB. On 2026-10-11, after the user freed space, the native Save flow completed and the extension reported success. A new PDF was verified on disk and all pages were rendered for inspection. That inspection identified restarted streamed-word animations in widened component clones, incorrect Unicode digit mappings, intrinsic Chinese labels wrapping, and oversized padded dividers. Focused regressions and fixes passed for all four. Private chat titles, URLs, and screenshots are excluded from public verification artifacts.

The final retried download contains 11 A4 pages (7,219,636 bytes). All pages were rendered again; the requested Home mockup, four-card personality grid, and design-sequence rows are preserved. The Home action and all five navigation labels remain intact, and the sequence retains thin dividers and its status badge. Separate PNGs were extracted from this completed PDF. Poppler text extraction confirms original color hex values, phase numbering, corner-radius ranges, and tap-target dimensions.

## Reproduce

```sh
npm ci
npm run check
npm test
```

Browser suites additionally require Playwright and compatible Chromium. `PLAYWRIGHT_MODULE` can identify an existing Playwright installation. `PLAYWRIGHT_EXECUTABLE` must identify a Chromium binary supporting unpacked extensions for the extension and side-panel suites.

Current v0.4.2 browser checks:

```sh
node tests/capture-browser.mjs
node tests/capture-scroll-browser.mjs
node tests/capture-speed-browser.mjs
node tests/rich-components-browser.mjs
node tests/extension-browser.mjs
node tests/side-panel-browser.mjs
```

Previous compatibility check, available to rerun:

```sh
node tests/chatgpt-compat-browser.mjs
```

Generated QA files stay under ignored `output/`; they are not part of the source release.

## Live-provider limits

An earlier manual ChatGPT export was reported successful; its format and complete contents were not independently verified. The current v0.4.2 live check qualifies the four-message conversation and static component structures described above. Long live ChatGPT conversations, Gemini, and other current provider layouts still need separate qualification.

Settled loaded boundaries and continuity checks provide DOM evidence, not authoritative server history completeness. Hidden branches, collapsed artifacts, attachments, and history that never mounts are not proven included. Preserved component snapshots do not retain interactive behavior or prove every screen/state was captured. Unsupported geometry fails explicitly instead of returning a detected partial transcript.

For a live qualification check, start midway through a long conversation. Compare known first, middle, and last messages and their order in both exported formats. Check cancellation, cancelled saves, retries, and failure reporting. Keep private conversations out of public fixtures, screenshots, and issues.
