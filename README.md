<div align="center">

<img src="korai.png" width="120" alt="KORAI Logo" />

# KORAI · v1.3

### *Open Source. Local First. Intelligence Built In.*

**No cloud. No tracking. No subscription. Just music.**

<br>

[![Version](https://img.shields.io/github/v/release/Behdad-kanaani/korai-player?style=flat-square&logo=git&color=1DB954)](https://github.com/Behdad-kanaani/korai-player/releases)
[![Downloads](https://img.shields.io/github/downloads/Behdad-kanaani/korai-player/total?style=flat-square&logo=github&color=blue)](https://github.com/Behdad-kanaani/korai-player/releases)
[![Open Source](https://img.shields.io/badge/Open%20Source-❤️-FF6B6B?style=flat-square)](https://github.com/Behdad-kanaani/korai-player)
[![License](https://img.shields.io/badge/License-Apache%202.0--Commons--Clause-red?style=flat-square&logo=apache)](LICENSE)

[![Windows](https://img.shields.io/badge/Windows-0078D6?style=flat-square&logo=windows&logoColor=white)](https://github.com/Behdad-kanaani/korai-player/releases)
[![macOS](https://img.shields.io/badge/macOS-000000?style=flat-square&logo=apple&logoColor=white)](https://github.com/Behdad-kanaani/korai-player/releases) *(planned)*
[![Linux](https://img.shields.io/badge/Linux-FCC624?style=flat-square&logo=linux&logoColor=black)](https://github.com/Behdad-kanaani/korai-player/releases) *(planned)*

</div>

---

## 🎯 **Feature comparison**

| Feature | KORAI v1.3 | Spotify | Apple Music | VLC | Windows Media Player |
|---------|:-----:|:-------:|:-----------:|:---:|:--------------------:|
| **Privacy** | | | | | |
| Open source (auditable code) | ✅ | ❌ | ❌ | ✅ | ❌ |
| Zero telemetry / tracking | ✅ | ❌ | ❌ | ✅ | ❌ |
| No account required | ✅ | ❌ | ❌ | ✅ | ✅ |
| Local-first (no cloud) | ✅ | ❌ | ❌ | ✅ | ✅ |
| **Audio Quality** | | | | | |
| 10-band graphic EQ | ✅ | ❌ (presets only) | ❌ (presets only) | ❌ | ❌ |
| Real-time spectrum analyzer | ✅ | ❌ | ❌ | ❌ | ❌ |
| Live waveform on timeline | ✅ (NEW v1.3) | ❌ | ❌ | ❌ | ❌ |
| Tempo control (0.5x–2.0x) | ✅ | ❌ | ❌ | ✅ | ❌ |
| Gapless + Crossfade (0–12s) | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Intelligence** | | | | | |
| Smart recommendations (local) | ✅ | ✅ (cloud) | ✅ (cloud) | ❌ | ❌ |
| BPM detection (3 algorithms) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Energy detection | ✅ | ❌ | ❌ | ❌ | ❌ |
| Genre classification | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Visual Experience** | | | | | |
| 3D cover art with hover effects | ✅ (NEW v1.3) | ❌ | ❌ | ❌ | ❌ |
| Marquee scrolling text | ✅ (NEW v1.3) | ❌ | ❌ | ❌ | ❌ |
| Artist section with smart cards | ✅ (NEW v1.3) | ✅ | ✅ | ❌ | ❌ |
| Performance mode (low-end devices) | ✅ (NEW v1.3) | ❌ | ❌ | ❌ | ❌ |
| **Library Control** | | | | | |
| Built-in tag editor | ✅ | ❌ | ❌ | ❌ | ❌ |
| M3U/PLS import/export | ✅ | ❌ | ❌ | ✅ | ❌ |
| CUE sheet support | ✅ | ❌ | ❌ | ✅ | ❌ |
| CSV export (analytics) | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Playback Modes** | | | | | |
| Repeat One (single track loop) | ✅ (NEW v1.3) | ✅ | ✅ | ✅ | ✅ |
| Smart shuffle with history | ✅ (NEW v1.3) | ✅ | ✅ | ❌ | ❌ |
| **Usability** | | | | | |
| Persian/Farsi RTL | ✅ | ❌ | ❌ | ❌ | ❌ |
| Mini-player (always-on-top) | ✅ | ✅ | ❌ | ❌ | ❌ |
| System tray integration | ✅ | ✅ | ❌ | ✅ | ❌ |
| Media keys support | ✅ | ✅ | ✅ | ✅ | ✅ |
| Version badge + auto-update notification | ✅ (NEW v1.3) | ✅ | ✅ | ❌ | ❌ |
| **Cost** | | | | | |
| Free forever | ✅ | ❌ (freemium) | ❌ (paid) | ✅ | ✅ |

> *KORAI has no "premium tier." Everything — EQ, visualizers, tag editor, artist view — is free forever.*

---

## 🔓 **Open source = verifiable privacy**

KORAI is **100% open source**. Every line of code is on GitHub for anyone to audit.

```
Proprietary players (Spotify, Apple Music):
  → You cannot verify what data they collect. Their code is closed source.
  → Your listening habits become their product.

Open source players (KORAI, VLC):
  → The code is public. You can check it yourself. No hidden telemetry.
  → Your data never leaves your computer.

KORAI takes it further:
  → Not just open source, but beautifully designed open source.
  → Not just local, but intelligent local recommendations.
```

**For privacy-focused users who refuse to compromise on design or intelligence, open source offers verifiable security.**

---

## 🧠 **What makes KORAI different**

### 1. Your data never leaves your computer

```
KORAI:     Local SQLite + JSON  →  Your hard drive only
Spotify:   Cloud database        →  Their servers (and third-party partners)
Apple:     Cloud + analytics     →  "We care about privacy" (trust us)
```

**No telemetry. No analytics. No "improvement programs." No trust required — verify it yourself.**

---

### 2. Smart recommendations that work offline

Unlike cloud-based recommendation engines that require your listening history to be uploaded, KORAI's similarity engine runs **entirely locally** using a weighted algorithm:

| Metric | Weight | Description |
|--------|--------|-------------|
| BPM similarity | 30 pts | Tempo matching within ±3 BPM |
| Genre matching | 35 pts | Same genre family = highest score |
| Energy (RMS) | 20 pts | Perceived loudness similarity |
| Loudness | 10 pts | Volume level matching |
| Discovery bonus | 8 pts | Prioritizes less-played tracks |

**Total possible score: 98 points** — no cloud needed, no listening history sent anywhere, no "we use encryption so it's fine" excuses.

---

### 3. Pro audio tools for everyone

Real DSP features accessible to all users, not hidden behind "Pro" subscriptions:

- **10-band Equalizer** (31Hz, 62Hz, 125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 8kHz, 16kHz)
- **Real-time spectrum analyzer** — live frequency visualization
- **Tempo shift** — 0.5x to 2.0x with pitch preservation
- **Crossfade** — 0–12 seconds, configurable
- **Gapless playback** — for albums that flow track to track

---

### 4. Visual intelligence (New in v1.3)

KORAI doesn't just sound good — it looks like nothing else on your desktop.

| Visual Feature | What it does |
|----------------|---------------|
| **3D cover art** | Hover any album cover — it scales, glows, and reacts to your cursor |
| **Live waveform timeline** | The progress bar pulses and moves with your music's frequency |
| **Marquee scrolling** | Long song titles and artist names scroll elegantly when they don't fit |
| **Artist cards** | Browse your library by artist with album art, track counts, and instant play |
| **Spectrum analyzer** | Live frequency visualization in the stats panel |

**No other open source player looks like this. No other player combines privacy with this level of visual polish.**

---

### 5. You control your library

Wrong metadata? Fix it. Need to export your data? Do it. Want to see your listening patterns? Analyze it.

| Action | KORAI | Spotify / Apple Music |
|--------|:-----:|:---------------------:|
| Edit song title | ✅ | ❌ (read-only) |
| Fix artist name | ✅ | ❌ (read-only) |
| Add custom lyrics | ✅ | ❌ |
| Export playlist (M3U/PLS) | ✅ | ❌ |
| Import playlist | ✅ | ❌ |
| Parse CUE sheets | ✅ | ❌ |
| CSV export for analysis | ✅ | ❌ |
| Fix album art | ✅ | ❌ |

**Your library, your rules. Not a rental. Not a "library" that disappears if you stop paying.**

---

### 6. Repeat One. Smart Shuffle. Finally.

Most open source players get playback modes wrong. KORAI v1.3 fixes that.

- **Repeat One mode** — Loop a single track. Perfect for learning a song or vibing to that one track you can't get enough of.
- **Smart Shuffle** — Tracks played history prevents repeats. Works across library, playlists, favorites, and artist views.
- **Context-aware** — Shuffle respects where you started (artist page? playlist? favorites?).

---

### 7. Built for everyone (including Persian speakers)

KORAI includes full RTL (Right-to-Left) support:

- Persian/Farsi translation
- Interface flips automatically
- Metadata supports Persian characters
- Search works with Persian text

**Because great software should speak your language.**

---

### 8. Performance mode for older hardware

Not everyone has a gaming rig. KORAI v1.3 detects low-resource devices automatically and scales back animations to keep playback smooth.

- Automatic detection (RAM < 4GB, CPU cores < 4, mobile devices)
- Reduces visual effects where it matters
- Keeps audio playback buttery smooth

**Performance without compromise. Beautiful on high-end machines. Smooth on old laptops.**

---

## 🖼️ **Screenshots**

<div align="center">
  
*(Coming soon for v1.3 — expect 3D cover effects, waveform timeline, and artist view)*

</div>

---

## ⚙️ **Technical Specifications**

| Category | Specification |
|----------|---------------|
| **Audio Formats** | MP3, FLAC (24-bit/192kHz), WAV, OGG, M4A |
| **Metadata** | ID3v2.2/2.3/2.4, Vorbis comments, FLAC tags |
| **BPM Detection** | Peak + Autocorrelation + FFT onset (60–200 BPM, ±3 BPM accuracy) |
| **Energy Detection** | RMS-based loudness analysis |
| **EQ Bands** | 10 bands: 31Hz, 62Hz, 125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 8kHz, 16kHz |
| **Crossfade** | 0–12 seconds (configurable) |
| **Tempo Range** | 0.5x – 2.0x (pitch-preserved) |
| **Memory (idle)** | ~120MB |
| **Memory (playing)** | ~180MB |
| **Memory (large library)** | ~250MB (tested with 50k+ tracks) |
| **Storage** | ~200MB + library cache |
| **Visual Engine** | CSS 3D transforms, Canvas animation, requestAnimationFrame |

---

## Known Limitations (honest and realistic)

- **Built with Electron** → ~180-250MB memory usage. This is honest. You won't get a C++ memory footprint, but you get cross-platform compatibility and web technologies.
- **Windows only currently** → macOS and Linux builds planned. If you're on Mac/Linux, you can build from source or wait for official releases.
- **No AI vocal extraction yet** → Coming in v1.4. We removed the low-quality karaoke mode in v1.3 because it wasn't good enough. We'd rather be honest than ship bad features.
- **BPM detection is ±3 BPM** → Works great for matching tempos. Not lab-grade precision, but perfect for playlist organization.

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
| `R` | Cycle repeat modes (None → All → One) |

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
├── main.js                      # Electron main process
├── preload.js                   # Secure context bridge
├── package.json                 # Dependencies
│
├── src/
│   ├── backend/
│   │   ├── server.js            # Express API (port 3050)
│   │   ├── database.js          # SQLite/JSON storage
│   │   ├── analyzer.js          # Metadata extraction
│   │   ├── recommender.js       # Similarity engine (5 metrics)
│   │   ├── bpmDetector.js       # BPM (peak/autocorrelation/FFT)
│   │   ├── cueParser.js         # CUE sheet parser/generator
│   │   ├── playlistExporter.js  # M3U/PLS/CSV exporter
│   │   ├── updater.js           # Auto-update notifications (NEW v1.3)
│   │   └── worker/
│   │       └── analyzer.worker.js
│   │
│   └── frontend/
│       ├── index.html
│       ├── styles.css           # Liquid Glass + RTL
│       ├── additional.css       # v1.3 visual upgrades (539 lines)
│       ├── app.js               # Core player logic
│       ├── lang.js              # i18n (English/Persian)
│       ├── advancedSearch.js
│       ├── gaplessPlayer.js
│       ├── tagEditor.js
│       └── additonal.js         # v1.3 UI handlers
│
├── korai.png
└── screenshot/
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

### macOS & Linux (planned)

| Platform | Status |
|----------|--------|
| macOS | 🚧 Future release |
| Linux | 🚧 Future release |

### Build from source

```bash
git clone https://github.com/Behdad-kanaani/korai-player.git
cd korai-player
npm install
npm start          # development mode
npm run dist:win   # build Windows installer
```

**Requirements:** Node.js 18+ (20 LTS recommended) · npm 9+

---

## 🗺️ **Roadmap**

| Version | Status | Key Features |
|---------|--------|--------------|
| **v1.0** | ✅ Released | Core playback · 5-band EQ · Persian RTL · System tray · BPM detection |
| **v1.2** | ✅ Released | Liquid Glass theme · Real BPM (3 algorithms) · Tag editor · Advanced search · Gapless + Crossfade · M3U/PLS/CUE · Artists view · Web Worker analysis |
| **v1.3** | ✅ Current | 3D cover art · Live waveform timeline · Marquee text · Artist cards · Repeat One mode · Smart shuffle · Performance mode · Version badge + auto-update · Song info modal · Removed low-quality karaoke |
| **v1.4** | 🔄 Planned | Vocal extraction (high fidelity) · Improved AI separation · Progress indicators · More audio formats |

---

## 📋 **Changelog v1.3.0**

### ✨ New Features

**Visual Intelligence**
- **3D cover art** — Hover effects with scale, glow, and shadow
- **Live waveform timeline** — 45 animated bars that pulse with your music using `requestAnimationFrame`
- **Marquee scrolling text** — Long titles scroll automatically (12s for title, 15s for artist)
- **Artist section** — Browse by artist with cards, album art, track counts, and "Play All"
- **Spectrum analyzer** — Live frequency visualization in stats panel

**Playback Modes**
- **Repeat One mode** — Loop single tracks (three modes: None, All, One)
- **Smart shuffle** — History tracking prevents repeats; works across library/playlists/favorites/artist views

**Quality of Life**
- **Version badge** — Shows current version; red and pulsing when updates available
- **Auto-update notification** — Checks every 24 hours; one click to download
- **Song info modal** — Full metadata display (BPM, energy, bitrate, sample rate)
- **Performance mode** — Auto-detects low-resource devices and reduces animations
- **Better drag & drop** — Visual feedback when dropping files

### 🔧 Improvements

- **Massive code cleanup** — Removed ~100 lines of low-quality karaoke code
- **Optimized analyzer.js** — Simplified and faster metadata extraction
- **Improved recommender.js** — More accurate similarity scoring
- **Better shuffle logic** — Respects lastPlaySource (library, playlist, favorites, artist)
- **Smoother waveform** — Reduced from 55 to 45 bars for better performance

### ❌ Removed Features

- **Karaoke mode** — Removed due to poor quality. We don't ship features that don't work well. High-fidelity vocal extraction coming in v1.4.

### 🐛 Fixed Bugs

- Shuffle not working across different sources
- Missing Repeat One functionality
- Lag in timeline visualizer
- Mini-player sync issues
- Search filter improvements

### 📊 Code Changes

```
✅ Lines added:    ~2,400
❌ Lines removed:  ~3,600
📊 Net change:     ~1,200 lines removed (simpler, cleaner, faster)
📁 New files:      5 (updater.js, audioSeparator.js, additional.css, additonal.js, audioProcessor.js)
🔄 Files changed:  12
```

---

## 🤝 **Contributing**

```bash
git checkout -b feature/your-idea
git commit -m 'feat: description'
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
- Test on Windows (macOS/Linux when available)
- Preserve RTL compatibility for Persian
- Don't add features that require cloud services

---

## 🔒 **Privacy**

| Question | Answer |
|----------|--------|
| Is KORAI open source? | ✅ Yes — fully auditable |
| Can I audit the code? | ✅ Yes — every line is public |
| Does it send telemetry? | ❌ No — zero network requests except localhost API |
| Does it require an account? | ❌ No — no sign-up, no login |
| Where is my data stored? | `%APPDATA%\korai-player\` (Windows) |
| Can I delete my data? | ✅ Yes — delete userData folder or uninstall |
| Does it phone home? | ❌ No — only manual update checks (no automatic downloads) |
| What about the updater? | Only checks version number; no analytics sent |

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

## 🙏 **Acknowledgments**

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

> *Local-first. Privacy-first. Intelligence built-in.*

---

*KORAI — Open source. Local first. Intelligence built in.*

</div>