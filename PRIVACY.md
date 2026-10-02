# Privacy

AI Chat Exporter is designed to process conversation data locally.

## Data handled

When you invoke the extension on a supported AI chat, it reads currently mounted conversation content and, during export, scrolls that tab to load earlier and later messages so it can create the requested PDF or Markdown file. This can include the conversation title, speaker roles, messages, headings, tables, and code.

Completed captures are held in the side panel's memory for retry or format changes. They are discarded when you rescan, reload, or close that panel; the extension does not persist a chat database. Progress events contain a job identifier, stage, and message count, and are sent only within the extension.

PDF appearance preferences are stored in the extension's local browser storage. Generated files are saved through Chrome's download interface to a location you choose.

## Data not collected

AI Chat Exporter does not include:

- analytics or tracking;
- advertising;
- a project-operated server or remote export API;
- user accounts;
- telemetry or crash reporting; or
- code that sends conversation content to the project maintainer.

Bundled PDF fonts are loaded from the installed extension package. No remote font service is used. The `sidePanel` permission displays export controls alongside the current chat; it does not grant additional site access.

## Third-party sites

AI Chat Exporter runs on AI chat pages that have their own privacy practices. This policy describes only AI Chat Exporter. It does not change how those sites process data.

## User control

The extension reads a supported tab only after the user invokes it. You choose whether to export and where the generated file is saved. Removing the extension removes its locally stored appearance preferences according to browser behavior; previously downloaded files remain under your control.
