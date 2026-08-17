# AI Chat Exporter

AI Chat Exporter is a local-first Chrome extension that exports conversations from popular AI chat sites to polished PDF or Markdown files.

Many tools in this space sit behind subscriptions or paid plans. This project was built as a free-to-use, source-available alternative for personal, educational, and other noncommercial use. Conversation content stays in the browser and is not sent to a project server.

> Status: portfolio project and early release. Site layout changes can temporarily break individual provider adapters.

## Features

- Export to PDF or Markdown.
- Support for ChatGPT, Claude, DeepSeek, Gemini, Microsoft Copilot, Perplexity, and Grok.
- Preserve speaker roles, headings, emphasis, tables, code, and useful reading structure.
- Choose PDF templates, text size, spacing, and accessible color presets.
- Preview PDF appearance before export.
- Process conversations locally without analytics, accounts, or a remote export API.

## Privacy and permissions

AI Chat Exporter requests only these Chrome permissions:

- `activeTab`: access the AI chat tab after you invoke the extension.
- `scripting`: run the matching conversation extractor in that tab.
- `downloads`: save the generated PDF or Markdown file through Chrome.

The extension has no host permissions, analytics, tracking, account system, or project-operated backend. Appearance preferences are stored in extension-local browser storage. See [PRIVACY.md](PRIVACY.md) for details.

## Install from source

Requirements: a recent Node.js release with npm and a Chromium-based browser.

```bash
npm ci
npm test
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the generated `dist` directory.

Run `npm run build` after source changes to rebuild `dist`.

## Use

1. Open a supported AI conversation.
2. Select the AI Chat Exporter extension.
3. Choose PDF or Markdown and, for PDF, adjust appearance.
4. Select **Export conversation** and choose where to save it.

## Project structure

```text
src/adapters/      Provider-specific DOM extraction
src/background/    Extension message handling and downloads
src/popup/         Export and preview interface
src/renderers/     Markdown and PDF generation
src/shared/        Shared protocol and appearance contracts
static/            Manifest, popup HTML/CSS, and bundled font
scripts/           Build helpers
tests/             Node-based regression tests
```

## Development

```bash
npm run check   # TypeScript validation
npm run build   # Generate extension in dist/
npm test        # Build and run all tests
```

## Security

Chat pages are untrusted input. Extracted content is converted into document data; it is not evaluated as extension code. Report security problems through GitHub's private vulnerability reporting. Do not post private chat content or exploit details in public issues.

## License

Project source is publicly available under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). Personal, educational, research, hobby, and other noncommercial uses are permitted. Commercial use, resale, paid redistribution, and use in a commercial product or service are not permitted by this license.

Because this restriction disallows commercial use, this project is **source-available**, not Open Source Initiative-approved open-source software. Third-party dependencies and the bundled font remain under their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

ChatGPT, Claude, DeepSeek, Gemini, Microsoft Copilot, Perplexity, and Grok are trademarks of their respective owners. This project is independent and is not endorsed by or affiliated with those providers.
