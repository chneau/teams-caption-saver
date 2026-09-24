# Teams Live Captions & Recording Saver

A modern, fast, privacy-friendly Manifest V3 browser extension built with
**TypeScript** and **Bun** for Microsoft Teams live captions and SharePoint /
Stream recording transcripts.

---

## Key Features

- **Live Teams Captions Capture**: Real-time DOM observer for Microsoft Teams
  web (`teams.microsoft.com`, `teams.cloud.microsoft`, `teams.live.com`).
- **Stream & SharePoint Recording Extraction**: Injected fetch interceptor
  (`interceptor.ts`) that extracts and parses full WebVTT transcripts from
  Microsoft Stream and SharePoint video players.
- **Direct-to-Disk Sync (File System Access API)**: Incrementally flushes
  transcripts every 2.5s directly to a chosen folder on your local disk.
- **In-Browser Meeting Database (IndexedDB)**: Full persistent meeting history
  with search, per-meeting deletion, and crash recovery.
- **Real-Time Live Web Viewer Tab**: Dedicated interactive tab (`viewer.html`)
  with real-time streaming captions, search/filter, autoscroll, attendee roster,
  and speaker alias editor.
- **Participant & Attendee Tracking**: Live attendee roster scraping with
  join/leave timestamps, total unique participants, and organizer/presenter
  roles.
- **Auto-Turn-On Live Captions**: Automatically triggers the Teams menu to
  enable captions when joining a meeting.
- **Multi-Format Downloads & Exports**: Instant export to **Markdown (`.md`)**,
  **Plain Text (`.txt`)**, **WebVTT (`.vtt`)**, **JSON Lines (`.jsonl`)**,
  **Full JSON (`.json`)**, and **CSV (`.csv`)**.
- **Speaker Aliasing**: Global and per-meeting name remapping.
- **Cross-Browser Compatibility**: Works on Chrome, Edge, Brave, Opera, and
  Firefox.
- **Strict TypeScript & Zero i18n Overhead**: Pure English UI, fully typed with
  strict `tsconfig.json`.

---

## Directory Structure

```
├── package.json
├── tsconfig.json
├── scripts/
│   └── build.ts                  # Bun bundler script (builds Chrome + Firefox packages)
├── public/
│   ├── manifest.json             # Manifest V3 configuration
│   └── icon.png
├── src/
│   ├── types/
│   │   └── captions.ts           # Type definitions
│   ├── formatters/
│   │   ├── filename.ts           # Filename sanitization & timestamping
│   │   ├── dedup.ts              # Deduplication engine & speaker aliases
│   │   ├── text.ts               # Plain text format generator
│   │   ├── markdown.ts           # Markdown format generator
│   │   ├── vtt.ts                # WebVTT parser & formatter
│   │   └── jsonl.ts              # JSONL, JSON, CSV formatters
│   ├── storage/
│   │   ├── idb.ts                # IndexedDB database manager
│   │   ├── fsAccess.ts           # File System Access API streaming writer
│   │   └── settings.ts           # Storage settings
│   ├── content/
│   │   ├── content_script.ts     # Live Teams captions & attendee tracker
│   │   ├── interceptor.ts        # Stream/SharePoint MAIN-world fetch interceptor
│   │   └── relay.ts              # ISOLATED-world relay to service worker
│   ├── background/
│   │   └── service_worker.ts     # Central background service worker
│   └── ui/
│       ├── popup/                # Extension popup UI
│       ├── viewer/               # Live interactive web viewer
│       └── options/              # Settings & tenant permissions UI
└── dist/                         # Ready-to-load extension builds & packages
```

---

## Installation Guide

### Option A: Install from GitHub Releases (Recommended for Users)

1. Go to the
   [**Releases Page**](https://github.com/chneau/teams-caption-saver/releases)
   and download the latest zip file:
   - For **Chrome / Edge / Brave / Opera**: Download `teams-caption-saver.zip`
   - For **Firefox**: Download `teams-caption-saver-firefox.zip`

#### Chrome / Edge / Brave / Opera:

1. Extract `teams-caption-saver.zip` to a folder on your computer.
2. Open `chrome://extensions` (or `edge://extensions` in Edge /
   `brave://extensions` in Brave).
3. Enable **Developer mode** (toggle switch in the top-right corner).
4. Click **Load unpacked** (top-left) and select the extracted folder.
5. The extension is now installed and ready to use!

#### Firefox:

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…**.
3. Select `teams-caption-saver-firefox.zip`.

---

### Option B: Build & Run from Source (Developers)

```bash
# Clone the repository
git clone https://github.com/chneau/teams-caption-saver.git
cd teams-caption-saver

# Install dependencies
bun install

# Run test suite and type check
bun run check
bun test

# Build extension into dist/
bun run build
```

Then load the [`dist`](./dist) folder via **Load unpacked** in your browser's
extension settings.
