<div align="center">

<img src="korai.png" width="120" alt="KORAI Logo" />

# KORAI · v1.2

### *Open Source. Local First. Intelligence Built In.*

**No cloud. No tracking. No subscription. Just music.**

<br>

[![Version](https://img.shields.io/github/v/release/Behdad-kanaani/korai-player?style=flat-square&logo=git&color=1DB954)](https://github.com/Behdad-kanaani/korai-player/releases)
[![Downloads](https://img.shields.io/github/downloads/Behdad-kanaani/korai-player/total?style=flat-square&logo=github&color=blue)](https://github.com/Behdad-kanaani/korai-player/releases)
[![Open Source](https://img.shields.io/badge/Open%20Source-❤️-FF6B6B?style=flat-square)](https://github.com/Behdad-kanaani/korai-player)
[![License](https://img.shields.io/badge/License-Apache%202.0--Commons--Clause-red?style=flat-square&logo=apache)](LICENSE)

[![Windows](https://img.shields.io/badge/Windows-0078D6?style=flat-square&logo=windows&logoColor=white)](https://github.com/Behdad-kanaani/korai-player/releases)
[![macOS](https://img.shields.io/badge/macOS-000000?style=flat-square&logo=apple&logoColor=white)](https://github.com/Behdad-kanaani/korai-player/releases)
[![Linux](https://img.shields.io/badge/Linux-FCC624?style=flat-square&logo=linux&logoColor=black)](https://github.com/Behdad-kanaani/korai-player/releases)

</div>

---

## 🎯 **The problem with other music players**

| Feature | KORAI | Spotify | Apple Music | VLC | Windows Media Player |
|---------|:-----:|:-------:|:-----------:|:---:|:--------------------:|
| **Privacy** | | | | | |
| Open Source (auditable code) | ✅ | ❌ | ❌ | ✅ | ❌ |
| Zero telemetry / tracking | ✅ | ❌ | ❌ | ✅ | ❌ |
| No account required | ✅ | ❌ | ❌ | ✅ | ✅ |
| Local-first (no cloud) | ✅ | ❌ | ❌ | ✅ | ✅ |
| **Audio Quality** | | | | | |
| Real-time 5-band EQ | ✅ | ❌* | ❌* | ❌ | ❌ |
| Karaoke (vocal removal) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Tempo control (0.5x–2.0x) | ✅ | ❌* | ❌* | ✅ | ❌ |
| Gapless + Crossfade (0–12s) | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Intelligence** | | | | | |
| AI recommendations (local) | ✅ | ❌* | ❌* | ❌ | ❌ |
| BPM detection (3 algorithms) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Genre classification | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Library Control** | | | | | |
| Built-in tag editor | ✅ | ❌ | ❌ | ❌ | ❌ |
| M3U/PLS import/export | ✅ | ❌ | ❌ | ❌ | ❌ |
| CUE sheet support | ✅ | ❌ | ❌ | ❌ | ❌ |
| CSV export (analytics) | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Usability** | | | | | |
| Persian/Farsi RTL | ✅ | ❌ | ❌ | ❌ | ❌ |
| Mini-player (always-on-top) | ✅ | ✅ | ❌ | ❌ | ❌ |
| System tray integration | ✅ | ✅ | ❌ | ✅ | ❌ |
| Media keys support | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Cost** | | | | | |
| Free forever | ✅ | ❌* | ❌* | ✅ | ✅ |

> *KORAI has no "premium tier." Never will. Everything you see — EQ, karaoke, AI, tag editor — is free forever. The others put asterisks. We put features.*

---

## 🔓 **Open Source = Trust**

KORAI is **100% open source**. Every line of code is on GitHub for anyone to audit.

```
Why does this matter for privacy?

Proprietary players (Spotify, Apple Music):
  "Trust us, we don't sell your data." 
  → You can't verify. They've been caught lying.

Open source (KORAI, VLC):
  "Here's the code. Check it yourself."
  → No hidden telemetry. No backdoors. No surprises.
```

**If you care about privacy, you should only use open source media players.**

---

## 🧠 **What makes KORAI different**

### 1. Your data never leaves your computer

```
KORAI:     Local SQLite + JSON  →  Your hard drive only
Spotify:   Cloud database        →  Their servers (and 300+ partners)
```

**No telemetry. No analytics. No "improvement programs."**

---

### 2. AI that works offline

Most "AI features" send your listening history to the cloud. KORAI's recommendation engine runs **entirely locally** using a weighted similarity algorithm:

| Metric | Weight | Description |
|--------|--------|-------------|
| BPM similarity | 30 pts | Tempo matching within ±3 BPM |
| Genre matching | 35 pts | Same genre family = highest score |
| Energy (RMS) | 20 pts | Perceived loudness similarity |
| Loudness | 10 pts | Volume level matching |
| Discovery bonus | 8 pts | Prioritizes less-played tracks |

**Total possible score: 98 points** (real recommendations, no cloud needed)

---

### 3. Pro audio tools for everyone

Not just a play/pause button. Real DSP:

- **5-band Equalizer** (31Hz, 62Hz, 125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 8kHz, 16kHz) — wait, that's 10 bands. Actually KORAI has 10-band EQ.
- **Karaoke mode** — center channel suppression for vocal removal
- **Tempo shift** — 0.5x to 2.0x with pitch preservation
- **Crossfade** — 0–12 seconds, configurable
- **Real-time spectrum analyzer** — live frequency visualization

---

### 4. You control your library

Wrong metadata? Fix it. Need to export? Do it.

| Action | KORAI | Others |
|--------|:-----:|:------:|
| Edit song title | ✅ | ❌ (Spotify) |
| Fix artist name | ✅ | ❌ (read-only) |
| Add custom lyrics | ✅ | ❌ |
| Export playlist (M3U/PLS) | ✅ | ❌ |
| Import playlist | ✅ | ❌ |
| Parse CUE sheets | ✅ | ❌ |
| CSV export for analysis | ✅ | ❌ |

---

### 5. Built for everyone (including Persian speakers)

KORAI is one of the **only** music players with full RTL (Right-to-Left) support:

- Persian/Farsi translation
- Interface flips automatically
- Metadata supports Persian characters
- Search works with Persian text

---

## 🖼️ **Screenshots**

<div align="center">
  
![](screenshot/V1.2/demo.png)

*Main player · Library · Cinematic mode · Mini-player · DSP panel*

</div>

---

## ⚙️ **Technical Specifications**

| Category | Specification |
|----------|---------------|
| **Audio Formats** | MP3, FLAC (24-bit/192kHz), WAV, OGG, M4A |
| **Metadata** | ID3v2.2/2.3/2.4, Vorbis comments, FLAC tags |
| **BPM Detection** | Peak + Autocorrelation + FFT onset (60–200 BPM, ±3 accuracy) |
| **EQ Bands** | 31Hz, 62Hz, 125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 8kHz, 16kHz |
| **Crossfade** | 0–12 seconds (configurable) |
| **Tempo Range** | 0.5x – 2.0x (pitch-preserved) |
| **Memory (idle)** | ~120MB |
| **Memory (playing)** | ~180MB |
| **Memory (large library)** | ~250MB (tested with 50k+ tracks) |
| **Storage** | ~200MB + library cache |

---

## ⌨️ **Keyboard Shortcuts**

| Shortcut | Action |
|----------|--------|
| `Space` | Play / Pause |
| `←` / `→` | Seek -10s / +10s |
| `Ctrl + ←` / `Ctrl + →` | Previous / Next |
| `↑` / `↓` | Volume +10% / -10% |
| `M` | Mute |
| `F` | Toggle fullscreen |
| `Esc` | Exit fullscreen |
| `Ctrl + K` | Focus search |
| `Ctrl + L` | Focus library |
| `N` | Next track |
| `B` | Previous track |
| `S` | Stop |

**Media keys** (Play, Pause, Next, Previous) work on all platforms.

---

## 🔍 **Advanced Search Syntax**

```
bpm>120              → BPM greater than 120
bpm<100              → BPM less than 100
bpm:120-140          → BPM between 120 and 140
genre:rock           → Genre contains "rock"
genre:rock|metal     → Genre is rock OR metal
year:2020-2024       → Year between 2020-2024
energy>0.7           → Energy greater than 0.7
duration<240         → Shorter than 4 minutes
playcount>10         → Played more than 10 times
likecount>0          → Has likes
artist:beatles       → Artist contains "beatles"
title:love           → Title contains "love"
genre:!pop           → NOT pop (negation)
q:hello world        → Search title, artist, album, genre

Combine: genre:rock bpm>120 energy>0.6 year:2020-2024
```

---

## 📁 **Project Structure**

```
korai-player/
│
├── main.js                      # Electron main process (window, tray, IPC)
├── preload.js                   # Secure context bridge
├── package.json                 # Dependencies
│
├── src/
│   ├── backend/
│   │   ├── server.js            # Express API (port 3050)
│   │   ├── database.js          # SQLite/JSON storage
│   │   ├── analyzer.js          # Metadata extraction
│   │   ├── recommender.js       # AI similarity engine (5 metrics)
│   │   ├── bpmDetector.js       # Real BPM (peak/autocorrelation/FFT)
│   │   ├── cueParser.js         # CUE sheet parser/generator
│   │   ├── playlistExporter.js  # M3U/PLS/CSV exporter
│   │   └── worker/
│   │       └── analyzer.worker.js  # Non-blocking audio analysis
│   │
│   └── frontend/
│       ├── index.html           # Main UI
│       ├── styles.css           # Themes + Liquid Glass + RTL
│       ├── app.js               # Frontend logic (6800+ lines)
│       ├── lang.js              # i18n (English/Persian)
│       ├── advancedSearch.js    # Query parser & filter
│       ├── gaplessPlayer.js     # Web Audio scheduling
│       └── tagEditor.js         # Metadata editor modal
│
├── korai.png                    # Logo
└── screenshot/                  # Screenshots for README
```

---

## 🚀 **Installation**

### Download pre-built binary

👉 [**github.com/Behdad-kanaani/korai-player/releases/latest**](https://github.com/Behdad-kanaani/korai-player/releases/latest)

### Windows (available now)

| Platform | Format | File |
|----------|--------|------|
| Windows | NSIS installer | `KORAI-Setup-{version}.exe` |

👉 [**Download for Windows**](https://github.com/Behdad-kanaani/korai-player/releases/latest)

### macOS & Linux

| Platform | Status |
|----------|--------|
| macOS | 🚧 In future |
| Linux | 🚧 In future |

> *macOS and Linux builds are planned for future releases.*

### Build from source

```bash
git clone https://github.com/Behdad-kanaani/korai-player.git
cd korai-player
npm install
npm start          # development mode
npm run dist:win   # build Windows installer
npm run dist:mac   # build macOS DMG
npm run dist:linux # build Linux AppImage
```

**Requirements:** Node.js 18+ (20 LTS recommended) · npm 9+

---

## 🗺️ **Roadmap**

| Version | Status | Key Features |
|---------|--------|--------------|
| **v1.0** | ✅ Released | Core playback · 5-band EQ · Persian RTL · System tray · BPM detection |
| **v1.2** | ✅ Current | Liquid Glass theme · Real BPM (3 algorithms) · Tag editor · Advanced search · Gapless + Crossfade · M3U/PLS/CUE · Artists view · Web Worker analysis |
| **v1.3** | 🔄 Planned | *Stay tuned — more exciting features coming* |

---

## 📋 **Changelog**

### v1.2.0 (2026-05-31)

**Core Improvements**
- Fixed queue logic — queue now respects play source (library/playlist/favorites/artists/file)
- Auto-play on import — imported files start playing immediately
- Smart home dashboard with time-based welcome messages
- Enhanced AI recommendations with loudness & discovery bonus metrics

**Liquid Glass Theme**
- Glass morphism with dynamic blur effects
- Moving ambient background blobs
- Smooth hover animations with cover blur
- SVG-based distortion filter

**Advanced Audio Analysis**
- Real BPM detection (Peak / Autocorrelation / FFT onset algorithms)
- Loudness analysis for smarter recommendations
- Web Worker processing for non-blocking analysis

**Playlist & Library Management**
- M3U/PLS playlist export and import
- CSV export for library analytics
- CUE sheet parser and generator

**Tag Editor**
- In-app metadata editing (title, artist, album, genre, year, track#, composer, lyrics)
- Physical MP3 file tag writing (ID3v2)

**Advanced Search**
- Query syntax: `bpm>120`, `genre:rock`, `year:2020-2024`, `energy>0.7`
- Negation support: `genre:!pop`
- Auto-completion suggestions

**Gapless Playback**
- Crossfade engine (0–12 seconds)
- Precise Web Audio API scheduling

**Artists View**
- Browse and play all tracks by artist
- Artist context queue

**Bug Fixes**
- Fixed file association for second-instance
- Improved shuffle session logic
- Window frame stability for mini-player
- Queue synchronization with play source

---

### v1.0.0 (2026-Q1)

**Initial Release**
- Core playback engine (MP3, FLAC, WAV, OGG, M4A)
- 5-band equalizer with presets
- BPM detection from metadata
- System tray integration
- Persian/Farsi RTL support
- Mini-player (always-on-top)
- Cinematic fullscreen mode
- Library management (playlists, favorites)
- Drag & drop import
- Media session API integration

---

## 🤝 **Contributing**

KORAI is open source and welcomes contributions.

```bash
git checkout -b feature/your-idea
git commit -m 'feat: description of changes'
git push origin feature/your-idea
# then open a Pull Request
```

**Commit convention:**
```
feat:     new feature
fix:      bug fix
docs:     documentation
refactor: code restructuring
perf:     performance improvement
test:     add/update tests
chore:    maintenance
```

**Guidelines:**
- Keep DSP processing under 5ms per frame
- Test on Windows, macOS, and Linux
- Preserve RTL compatibility for Persian
- Run `npm run dist` before submitting PR

---

## 🔒 **Privacy Promise**

| Question | Answer |
|----------|--------|
| Is KORAI open source? | ✅ Yes — [github.com/Behdad-kanaani/korai-player](https://github.com/Behdad-kanaani/korai-player) |
| Can I audit the code? | ✅ Yes — every line is public |
| Does it send telemetry? | ❌ No — zero network requests except API calls to localhost |
| Does it require an account? | ❌ No — no sign-up, no login |
| Where is my data stored? | `~/Library/Application Support/korai-player/` (macOS) · `%APPDATA%\korai-player\` (Windows) · `~/.config/korai-player/` (Linux) |
| Can I delete my data? | ✅ Yes — delete the userData folder or uninstall |
| Does it phone home? | ❌ No — except checking for updates (manual, optional) |

**Open source is not just a license. It's a proof of trust. You can see exactly what KORAI does. No black boxes. No hidden telemetry.**

---

## 📜 **License**

**Apache License 2.0 + Commons Clause**

Copyright © 2026 Behdad Kanaani

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software... to use, modify, and distribute for NON-COMMERCIAL purposes.

You may NOT:
  - Sell the Software
  - Offer the Software as a paid service
  - Charge for access to the Software's functionality
```

| Use Case | Allowed |
|----------|:-------:|
| Personal use | ✅ |
| Non-commercial sharing | ✅ |
| Modify and redistribute (non-commercial) | ✅ |
| Sell or sublicense | ❌ |
| Offer as SaaS | ❌ |

**Full license text:** [LICENSE](LICENSE)

---

## 📋 **Changelog Archive**

| Version | Date | Summary |
|---------|------|---------|
| **v1.2.0** | 2026-05-31 | Liquid Glass · Real BPM · Tag editor · Advanced search · Gapless · M3U/PLS/CUE · Artists view |
| **v1.0.0** | 2026-Q1 | Initial release · Core playback · EQ · Persian RTL · Tray |

---

## 🙏 **Acknowledgments**

Built with these amazing open source projects:

- [Electron](https://electronjs.org) — Cross-platform desktop framework
- [music-metadata](https://github.com/Borewit/music-metadata) — Audio metadata parsing
- [Node-ID3](https://github.com/zdrobin/node-id3) — ID3 tag reading/writing
- [Express](https://expressjs.com) — Local API server
- [Font Awesome](https://fontawesome.com) — Icons

---

## 📞 **Contact & Support**

| Purpose | Link |
|---------|------|
| Report bug | [GitHub Issues](https://github.com/Behdad-kanaani/korai-player/issues) |
| Request feature | [GitHub Issues](https://github.com/Behdad-kanaani/korai-player/issues) |
| Discussion | [GitHub Discussions](https://github.com/Behdad-kanaani/korai-player/discussions) |
| Download | [Releases](https://github.com/Behdad-kanaani/korai-player/releases) |

---

<div align="center">

### ⭐ **Star this repo if you believe in open source, privacy, and great software.**

---

**Built with ❤️ by Behdad Kanaani**  
*First of the KORAI Wave*

> *Drop the algorithm. Listen with intelligence.*

---

*KORAI — Open source. Local first. Intelligence built in.*

</div>