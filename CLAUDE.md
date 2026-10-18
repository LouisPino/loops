# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Loops is a programmable metronome for additive meters (`3/8 + 3/32`, `7/32 + 5/32 *4`). It is a single-page, dependency-free browser app: `index.html` + `style.css` + `script.js`, plus a Node script (`sync.js`) that generates `library.js`. There is no package.json, no build step, no test suite, and no framework. Keep it that way unless asked otherwise — adding a toolchain would break the "open the file and it works" property the whole design is built around.

## Commands

```bash
node sync.js                 # regenerate library.js after adding/renaming/deleting a .json sequence
python3 -m http.server       # serve the folder (optional; see below)
open index.html              # run straight off disk
```

`node sync.js` is the only build-ish command. Run it whenever the set of `.json` sequence files in the folder changes.

## The file:// constraint

This is the single most important architectural fact. The app is meant to run by double-clicking `index.html`, where the browser refuses to `fetch` neighbouring files. So:

- `sync.js` scans every `*.json` in the folder, validates it looks like a sequence, and writes `library.js` containing both a `files` list **and** an `inline` copy of each sequence's parsed JSON.
- `loadLibrary()` in `script.js` fetches the real `.json` files when `location.protocol !== 'file:'` (so edits show on reload when served) and falls back to the inlined copies otherwise.
- Consequence: over `file://`, editing a `.json` has no effect until `node sync.js` runs. Over `http://`, only *adding or removing* files needs a sync.

Never hand-edit `library.js` — it is generated.

## Data model

The pipeline is: notation string → `parseNotation` → `buildMeasure` → measure object consumed by engraving, the list, and the audio scheduler.

- `parseNotation(str)` → `{ groups: [{count, unit, tuplet?}], repeat, written }`. Accepts `3/8`, bracketed `[3]8`, `+`-joined groups, a trailing `*4` / `x4` repeat, and a per-group tuplet suffix `6/16:5` (or `6/16:5:4`). `written` preserves the file's own spelling so the display echoes the score's convention; `canonical()` is the normalized form.
- **Tuplets are duration only.** `tuplet` is `{n, m}` — n notes in the time of m, m defaulting to `evenBelow(n)` (the power of two under n, so `:5` is 5-in-4). A quintuplet 16th is still a 16th for beaming, note width, and the `TICKS_EVERY` rule; only its length changes. Never compute a note length as `4 / unit` directly — use `noteBeatsOf(group)` / `groupBeats(group)`.
- `buildMeasure` expands groups into a flat `notes` array where each note carries `beats` (offset in **quarter-note** beats), `audible`, and `accent`. Tempo is always the quarter note.
- **Silent notes stay in the model.** `TICKS_EVERY = u => u <= 8` — 16ths and shorter sound only on the group head, but every note is still present so the engraving and playhead can show the complete figure. Anything that iterates `notes` must respect the `audible` flag rather than filtering the array.
- Parse failures never throw out of `readSequence`; they become `faultyMeasure` entries with an `error` string, rendered as `.bad` rows and skipped by `buildPlan`.
- `readSequence` accepts several shapes on purpose: a bare array, `{measures|sequence|bars}`, string or numeric entries, and object entries with `notation|measure|bar|signature`, `repeat|repeats|times`, `label|mark`, or an explicit `groups` array. Keep new input handling equally forgiving. `measureFrom` builds one measure from one entry and is the single place those aliases are read.
- **Phrases are flat, not nested.** An entry holding its own array (`{ "phrase": [...], "repeat": 3 }`, also `measures|group|bars|sequence`, or a bare nested array) expands into ordinary consecutive measures, each tagged `phrase: {id, repeat, size, first, last}`. Measure numbering is a running counter over the expanded list, so a sequence's row count is not its entry count. Phrases do not nest — an inner phrase becomes a `faultyMeasure`. The repeat itself is enforced only in `advance()`.

## Runtime structure (script.js)

Two module-level singletons hold everything:

- `S` — app state: loaded `files` (each `{id, name, origin, raw, seq}` where `origin` is `'folder'` or `'opened'`), active sequence, bpm, start/end range, loop, volume. `save()` persists to `localStorage` under `loops.files.v2` / `loops.prefs.v2`, and deliberately persists **only** `origin: 'opened'` files — folder sequences are re-read from `library.js` each load and supersede stale opened copies of the same name.
- `A` — audio/transport: `AudioContext`, the scheduling `plan` (measure indices in range), `cursor`, and the visual `queue`.

Playback uses the standard lookahead pattern: `schedule()` runs on a 25 ms `setInterval`, scheduling `click()` oscillators up to 120 ms ahead via `A.ctx.currentTime`, while `frame()` on `requestAnimationFrame` drains `A.queue` to drive the playhead, note flashes, and the "now playing" row. Never drive audio timing off `requestAnimationFrame` or `setTimeout` — the frame loop is suspended in hidden tabs, which is why `schedule()` prunes stale queue entries.

`advance()` is the sole place the cursor walks note → repeat → phrase pass → measure → loop/end, so repeat and range semantics live in one function. A phrase repeats by moving `cursor.slot` back to `phraseHome(id)` — the first slot of that phrase **still inside the plan** — so a start/end range that cuts into a phrase drills the part of it that is in range.

## Rendering

Both renderers emit SVG strings, not DOM nodes:

- `engrave(measure)` draws the large stage score and returns `{markup, beatsToX, width}`. `beatsToX` is the shared coordinate map that lets the playhead ride exactly the same grid the notes were laid out on; `SCORE.beatsToX` caches the current one. Layout constants (`NOTE_W`, `GAP`, `TOP`, `BASE`, beam geometry) sit above the function.
- `miniStrip(measure, longestBeats)` draws the per-row rhythm profile in the measure list, scaled against the longest measure in the sequence so density and length stay comparable down the column.

Painting is coarse and full-redraw: `paintPicker`, `paintList`, `paintTransport`, `paintNow`, `drawScore`, with `paintAll()` running the lot. After mutating `S`, call the relevant paint function and `save()`. All user text goes through `escapeHtml` since rows are built with `innerHTML`.

New UI needs three things: markup in `index.html`, a listener registered in `wire()`, and state reflected in a `paint*` function.

## Style

- `style.css` is a dark, single-accent design (`--strike` amber appears **only** while the sequence sounds). Use the existing custom properties rather than literal colors.
- Both CSS and JS honour `prefers-reduced-motion` — the note strike is kept (it is the beat readout), sweeping motion is not.
- The code voice is plain-English comments explaining *why* a constraint exists, section banners (`/* ---------- name ---- */`), and short helper arrows. Match it.
