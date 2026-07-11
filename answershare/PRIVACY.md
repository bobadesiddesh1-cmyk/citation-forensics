# AnswerShare — Privacy Policy

_Last updated: July 2026_

AnswerShare is a browser extension that tracks, **entirely on your device**,
which websites AI assistants (ChatGPT, Perplexity, Gemini) cite in answers
to your own queries, and analyzes the text structure of cited pages.

## What the extension stores (locally only)

- **Citation records**: the query you asked an AI assistant, the AI site,
  the list of cited domains/URLs with their order, and the answer text —
  captured from your own chat sessions.
- **Page profiles**: aggregate structural statistics (sentence counts,
  average lengths, percentages) about pages you explicitly analyze.
- **Settings**: your domains, competitor domains, topics, and toggles.

All of this lives in Chrome's extension storage (`chrome.storage.local` /
`chrome.storage.session`) **in your browser, on your device**. Records are
capped (oldest deleted first) and can be deleted at any time from the
dashboard ("clear all").

## What the extension does NOT do

- It makes **zero network requests**. There is no server, no sync, no
  telemetry, no analytics, no error reporting, and no remote code.
- It does **not collect, transmit, sell, or share** any data with anyone,
  including the developer. Nothing ever leaves your browser.
- It does not read pages you browse. On ordinary pages, the content script
  performs a single sub-millisecond check for an extension-specific URL
  fragment and exits. A page's content is only analyzed when you explicitly
  trigger a trace/profile on that page, and the analysis happens locally.
- It does not use cookies, fingerprinting, or identifiers of any kind.

## Data removal

Uninstalling the extension deletes all stored data. You can also clear
records and profiles from the dashboard at any time.

## Changes & contact

Any future change to these practices will be reflected in this document and
in the extension's store listing before release. Questions:
open an issue on this repository.
