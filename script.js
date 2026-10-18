/* ============================================================
   LOOPS — a programmable metronome for additive meters.

   Notation
     5/8             five eighths, every one ticks
     7/32            a figure of seven 32nds, only the first ticks
     3/16            three 16ths, only the first ticks
     5/8 + 7/32      groups joined within one measure
     7/32 + 5/32     the head of each figure ticks
     ... *4          the measure plays four times
     6/16:5          six 16ths at quintuplet speed (5 in the time of 4)
     6/16:5:4        the same, with the ratio spelled out

   Bracketed forms ([5]8) parse the same, but everything is shown as x/8.

   A run of measures repeats as a block:
     { "phrase": ["2/8", "3/8", "2/8 + 1/16"], "repeat": 3 }

   Tempo is the quarter note. The measure downbeat is accented;
   everything else takes the plain click.
   ============================================================ */

'use strict';

const UNITS = new Set([1, 2, 4, 8, 16, 32, 64]);
const TICKS_EVERY = u => u <= 8;          // 16ths and shorter sound only on the group head
const $ = id => document.getElementById(id);

/* ---------- notation ------------------------------------ */

/* A tuplet is n notes in the time of m. Left unsaid, m is the plain-note
   count the figure displaces — the power of two below n, so :5 is 5-in-4,
   :3 is 3-in-2, :7 is 7-in-4. Only the duration changes; a quintuplet 16th
   is still written and beamed as a 16th. */
const evenBelow = n => Math.pow(2, Math.floor(Math.log2(n)));

function readTuplet(nRaw, mRaw, part) {
  const n = parseInt(nRaw, 10);
  const m = mRaw != null ? parseInt(mRaw, 10) : evenBelow(n);
  if (!(n > 1) || n > 64) throw new Error(`"${part}" — a tuplet holds 2 to 64 notes (${nRaw})`);
  if (!(m >= 1) || m > 64) throw new Error(`"${part}" — a tuplet spans 1 to 64 plain notes (${mRaw})`);
  return { n, m };
}

const tupletText = t => `:${t.n}${t.m === evenBelow(t.n) ? '' : ':' + t.m}`;

/* one note's length in quarter-note beats, tuplet included */
const noteBeatsOf = g => (4 / g.unit) * (g.tuplet ? g.tuplet.m / g.tuplet.n : 1);
const groupBeats = g => g.count * noteBeatsOf(g);

function parseNotation(input) {
  const src = String(input == null ? '' : input).trim();
  if (!src) throw new Error('the measure is empty');

  let repeat = 1;
  const body = src.replace(/[*x×]\s*(\d+)\s*$/i, (_, n) => {
    repeat = Math.max(1, parseInt(n, 10));
    return '';
  }).trim();

  const parts = body.split('+').map(s => s.trim());
  if (!parts.length || !parts[0]) throw new Error(`nothing to play in "${src}"`);
  if (parts.some(p => !p)) throw new Error(`"${src}" has a + with no group beside it`);

  const groups = parts.map(part => {
    const m = part.match(/^\[?\s*(\d+)\s*\]?\s*\/?\s*(\d+)\s*(?::\s*(\d+)\s*(?::\s*(\d+)\s*)?)?$/);
    if (!m) throw new Error(`couldn't read "${part}" — groups look like [5]8, 7/32, or 6/16:5`);
    const count = parseInt(m[1], 10);
    const unit = parseInt(m[2], 10);
    if (count < 1) throw new Error(`"${part}" needs at least one note`);
    if (!UNITS.has(unit)) throw new Error(`"${part}" uses a note value Loops doesn't read (${unit})`);
    const g = { count, unit };
    if (m[3] != null) g.tuplet = readTuplet(m[3], m[4], part);
    return g;
  });

  // keep the form the file was written in — [3]8 and 3/8 mean the same thing,
  // and the display should echo whichever convention the score uses
  return { groups, repeat, written: parts.join(' + ') };
}

function canonical(groups, repeat) {
  const s = groups.map(g => `${g.count}/${g.unit}${g.tuplet ? tupletText(g.tuplet) : ''}`).join(' + ');
  return repeat > 1 ? `${s} *${repeat}` : s;
}

/* Expand groups into every note, sounding or not, with its offset in
   quarter-note beats. Silent notes stay in the model so the engraving
   and the playhead can show the whole figure. */
function buildMeasure(index, groups, repeat, label, written, phrase) {
  const notes = [];
  let beats = 0;
  groups.forEach((g, gi) => {
    const noteBeats = noteBeatsOf(g);
    for (let i = 0; i < g.count; i++) {
      notes.push({
        beats: beats + i * noteBeats,
        noteBeats,
        unit: g.unit,
        tuplet: g.tuplet || null,
        groupIndex: gi,
        noteIndex: i,
        audible: TICKS_EVERY(g.unit) || i === 0,
        accent: gi === 0 && i === 0
      });
    }
    beats += g.count * noteBeats;
  });
  return {
    index, groups, notes, repeat, label,
    phrase: phrase || null,
    beats,
    text: canonical(groups, repeat),
    written: written || canonical(groups, 1),
    error: null
  };
}

function faultyMeasure(index, raw, message, phrase) {
  return {
    index, groups: [], notes: [], repeat: 1, label: null,
    phrase: phrase || null,
    beats: 0, text: String(raw), written: String(raw), error: message
  };
}

/* ---------- sequence files ------------------------------ */

const timesOf = e => Math.max(1, parseInt(e.repeat || e.repeats || e.times || 1, 10));
const rawOf = e => (typeof e === 'string' ? e : JSON.stringify(e));

/* A phrase entry carries its own list of measures under any of these keys —
   "measures" among them, so a phrase reads like a little sequence of its own. */
const PHRASE_KEYS = ['phrase', 'measures', 'group', 'bars', 'sequence'];

function phraseBody(entry) {
  if (Array.isArray(entry)) return entry;
  if (!entry || typeof entry !== 'object') return null;
  for (const k of PHRASE_KEYS) if (Array.isArray(entry[k])) return entry[k];
  return null;
}

/* One measure from one entry. Throws; the callers turn that into a bad row. */
function measureFrom(entry, index, phrase) {
  if (typeof entry === 'string' || typeof entry === 'number') {
    const p = parseNotation(entry);
    return buildMeasure(index, p.groups, p.repeat, null, p.written, phrase);
  }
  if (entry && typeof entry === 'object') {
    const label = entry.label || entry.mark || null;
    const repeat = timesOf(entry);
    const written = entry.notation || entry.measure || entry.bar || entry.signature;
    if (written != null) {
      const p = parseNotation(written);
      return buildMeasure(index, p.groups, Math.max(repeat, p.repeat), label, p.written, phrase);
    }
    if (Array.isArray(entry.groups)) {
      const groups = entry.groups.map(g => {
        if (typeof g === 'string') return parseNotation(g).groups[0];
        const count = parseInt(g.count != null ? g.count : g[0], 10);
        const unit = parseInt(g.unit != null ? g.unit : g[1], 10);
        if (!count || !UNITS.has(unit)) throw new Error(`group ${JSON.stringify(g)} is unreadable`);
        const out = { count, unit };
        if (g.tuplet != null) {
          const t = Array.isArray(g.tuplet) ? g.tuplet : [g.tuplet, g.inTheTimeOf];
          out.tuplet = readTuplet(t[0], t[1] == null ? null : t[1], `${count}/${unit}`);
        }
        return out;
      });
      return buildMeasure(index, groups, repeat, label, null, phrase);
    }
  }
  throw new Error('unrecognised measure');
}

function readSequence(data, fallbackName) {
  let list, title = fallbackName, tempo = null;

  if (Array.isArray(data)) {
    list = data;
  } else if (data && typeof data === 'object') {
    list = data.measures || data.sequence || data.bars;
    title = data.title || data.name || fallbackName;
    tempo = Number(data.tempo || data.bpm) || null;
  }
  if (!Array.isArray(list)) throw new Error('needs a "measures" array, or a top-level array');
  if (!list.length) throw new Error('has no measures');

  const measures = [];
  let phrases = 0;

  const push = (entry, phrase) => {
    const n = measures.length + 1;
    try {
      measures.push(measureFrom(entry, n, phrase));
    } catch (err) {
      measures.push(faultyMeasure(n, rawOf(entry), err.message, phrase));
    }
  };

  list.forEach(entry => {
    const body = phraseBody(entry);
    if (!body) { push(entry, null); return; }

    // a phrase stays several rows in the list — it is the block that repeats,
    // so every measure of it carries the same phrase tag
    if (!body.length) {
      measures.push(faultyMeasure(measures.length + 1, rawOf(entry), 'a phrase with no measures'));
      return;
    }
    const id = ++phrases;
    const repeat = Array.isArray(entry) ? 1 : timesOf(entry);
    const label = Array.isArray(entry) ? null : (entry.label || entry.mark || null);

    body.forEach((inner, k) => {
      const phrase = {
        id, repeat, size: body.length,
        first: k === 0,
        last: k === body.length - 1
      };
      if (phraseBody(inner)) {
        measures.push(faultyMeasure(measures.length + 1, rawOf(inner), 'phrases don’t nest — flatten it', phrase));
      } else {
        push(inner, phrase);
      }
      if (k === 0 && label && !measures[measures.length - 1].label) {
        measures[measures.length - 1].label = label;
      }
    });
  });

  return { title: String(title), tempo, measures };
}

/* ---------- examples ------------------------------------ */

const EXAMPLES = [
  {
    name: 'study-i.json',
    body: {
      title: 'Study I — additive eighths',
      tempo: 66,
      measures: [
        '5/8', '3/8', '7/8', '3/8 *2',
        '5/8 + 7/32', '3/8 + 5/32', '5/8 + 7/32 *3',
        '2/8 + 7/32 + 5/32', '7/32 + 5/32 + 3/32',
        '3/16', '5/8', '1/8'
      ]
    }
  },
  {
    name: 'figure-cycle.json',
    body: {
      title: 'Figure cycle',
      tempo: 84,
      measures: [
        { notation: '7/32 + 5/32', repeat: 4, label: 'A' },
        '4/8 + 3/32',
        { notation: '5/32 + 7/32 + 11/32', repeat: 2 },
        '6/8 *2',
        { notation: '3/16', label: 'B' },
        '9/8 + 7/32'
      ]
    }
  }
];

/* ---------- state --------------------------------------- */

const S = {
  files: [],          // { id, name, origin: 'folder' | 'opened', raw, seq }
  activeId: null,
  seq: null,
  bpm: 72,
  start: 1,
  end: 1,
  loop: false,
  volume: 0.7,
  countIn: false,
  countInEighths: 4   // counted in eighths whatever the measure is written in
};

const STORE_FILES = 'loops.files.v2';
const STORE_PREFS = 'loops.prefs.v2';

function save() {
  try {
    // folder sequences come from library.js on every load; only remember the
    // ones the user opened by hand
    localStorage.setItem(STORE_FILES, JSON.stringify(
      S.files.filter(f => f.origin === 'opened').map(f => ({ name: f.name, raw: f.raw }))
    ));
    localStorage.setItem(STORE_PREFS, JSON.stringify({
      activeId: S.activeId, bpm: S.bpm, start: S.start, end: S.end,
      loop: S.loop, volume: S.volume,
      countIn: S.countIn, countInEighths: S.countInEighths
    }));
  } catch (_) { /* storage full or blocked — the app still runs */ }
}

let PREFS = {};

function restorePrefs() {
  try { PREFS = JSON.parse(localStorage.getItem(STORE_PREFS)) || {}; } catch (_) { PREFS = {}; }
  if (PREFS.bpm) S.bpm = clamp(PREFS.bpm, 20, 300);
  if (PREFS.volume != null) S.volume = PREFS.volume;
  S.loop = !!PREFS.loop;
  S.countIn = !!PREFS.countIn;
  if (PREFS.countInEighths) S.countInEighths = clamp(PREFS.countInEighths, 1, 16);

  try {
    (JSON.parse(localStorage.getItem(STORE_FILES)) || []).forEach(f => {
      try { addFile(f.name, f.raw, 'opened'); } catch (_) {}
    });
  } catch (_) {}
}

/* Sequences sitting next to index.html, listed by library.js. Over http the
   files themselves are fetched so edits show up on reload; opened from disk
   the browser blocks that, and the copies inlined by sync.js are used. */
async function loadLibrary() {
  const lib = window.LOOPS_LIBRARY;
  if (!lib || !Array.isArray(lib.files)) return;
  const canFetch = location.protocol !== 'file:';

  for (const name of lib.files) {
    let raw = null;
    if (canFetch) {
      try {
        const res = await fetch(name, { cache: 'no-store' });
        if (res.ok) raw = await res.json();
      } catch (_) { /* fall through to the inlined copy */ }
    }
    if (!raw && lib.inline) raw = lib.inline[name];
    if (!raw) continue;
    try { addFile(name, raw, 'folder'); }
    catch (err) { toast(`${name}: ${err.message}`, true); }
  }
}

function chooseInitial() {
  const target = S.files.find(f => f.id === PREFS.activeId) ||
                 S.files.find(f => f.origin === 'folder') ||
                 S.files[0];
  if (!target) return;
  selectFile(target.id, { adoptTempo: PREFS.bpm == null });
  if (target.id === PREFS.activeId) {
    if (PREFS.start) S.start = clamp(PREFS.start, 1, S.seq.measures.length);
    if (PREFS.end) S.end = clamp(PREFS.end, S.start, S.seq.measures.length);
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || lo));

function addFile(name, raw, origin) {
  const seq = readSequence(raw, name.replace(/\.json$/i, ''));
  const file = { id: `${origin}:${name}`, name, origin, raw, seq };
  const existing = S.files.findIndex(f => f.name === name);
  // a folder sequence supersedes a stale opened copy of the same name
  if (existing >= 0) S.files[existing] = file; else S.files.push(file);
  return file;
}

/* Switching between loaded sequences leaves the dial where you set it —
   sections of one piece are usually worked at one tempo. A file's own tempo
   only takes the dial when the file first turns up (opened, dropped, or
   restored with no remembered tempo). */
function selectFile(id, opts) {
  const file = S.files.find(f => f.id === id);
  if (!file) return;
  stop();
  S.activeId = id;
  S.seq = file.seq;
  S.start = 1;
  S.end = file.seq.measures.length;
  if (opts && opts.adoptTempo && file.seq.tempo) S.bpm = clamp(file.seq.tempo, 20, 300);
}

/* ---------- engraving ----------------------------------- */

const NOTE_W = { 1: 104, 2: 78, 4: 60, 8: 40, 16: 24, 32: 16, 64: 11 };
const GAP = 30, PAD_X = 16, TOP = 40, BASE = 96, BEAM_H = 4, BEAM_GAP = 3.4;
const beamCount = u => Math.max(0, Math.round(Math.log2(u / 4)));

/* A tuplet note is drawn narrower than the plain note it is written as, in
   the same proportion it is played, so the spacing keeps reading as time. */
const noteWidth = n => {
  const base = NOTE_W[n.unit] || 16;
  return n.tuplet ? Math.max(11, Math.round(base * n.tuplet.m / n.tuplet.n)) : base;
};

/* Lays the measure out left to right, then returns the SVG markup plus a
   map from beat offset to x so the playhead can ride the same grid. */
function engrave(measure) {
  if (!measure || !measure.notes.length) return null;

  const placed = [];
  let x = PAD_X, prevGroup = 0;
  measure.notes.forEach((n, i) => {
    if (n.groupIndex !== prevGroup) { x += GAP; prevGroup = n.groupIndex; }
    placed.push({ n, i, x, w: noteWidth(n) });
    x += noteWidth(n);
  });
  const width = x + PAD_X;

  const svg = [];
  measure.groups.forEach((g, gi) => {
    const own = placed.filter(p => p.n.groupIndex === gi);
    const x0 = own[0].x, x1 = own[own.length - 1].x;
    const span = x1 - x0;

    // beams: one bar per flag, so the note value is visible at a glance
    for (let b = 0; b < beamCount(g.unit); b++) {
      const y = TOP + b * (BEAM_H + BEAM_GAP);
      const w = span > 0 ? span : 9;
      svg.push(`<rect class="beam" x="${x0}" y="${y}" width="${w}" height="${BEAM_H}"/>`);
    }

    // bracket and count above the group
    const bx1 = span > 0 ? x1 : x0 + 9;
    svg.push(`<path class="bracket" d="M${x0} 30 L${x0} 24 L${bx1} 24 L${bx1} 30"/>`);
    const mid = (x0 + bx1) / 2;
    svg.push(`<text class="count" x="${mid}" y="18" text-anchor="middle">${g.count}</text>`);
    svg.push(`<text class="unit-lbl" x="${mid}" y="${BASE + 26}" text-anchor="middle">${g.unit}</text>`);

    // the tuplet numeral rides above the beam, where a score puts it
    if (g.tuplet) {
      const t = tupletText(g.tuplet).slice(1);
      svg.push(`<text class="tuplet-lbl" x="${mid}" y="${TOP - 3}" text-anchor="middle">${t}</text>`);
    }

    if (gi < measure.groups.length - 1) {
      const next = placed.find(p => p.n.groupIndex === gi + 1);
      svg.push(`<text class="plus" x="${(bx1 + next.x) / 2}" y="${TOP + 12}" text-anchor="middle">+</text>`);
    }
  });

  placed.forEach(p => {
    const cls = `note${p.n.accent ? ' accent' : ''}${p.n.audible ? '' : ' silent-note'}`;
    svg.push(
      `<g class="${cls}" data-i="${p.i}">` +
      `<line class="stem" x1="${p.x}" y1="${TOP}" x2="${p.x}" y2="${BASE}"/>` +
      `<ellipse class="head${p.n.audible ? '' : ' silent'}" cx="${p.x + 3.6}" cy="${BASE}" rx="4.4" ry="3.3" transform="rotate(-18 ${p.x + 3.6} ${BASE})"/>` +
      `</g>`
    );
  });

  // parked outside the viewBox until the transport moves it
  svg.push(`<g class="playhead"><line x1="-20" y1="14" x2="-20" y2="${BASE + 12}"/></g>`);

  const beatsToX = beats => {
    if (beats <= 0) return placed[0].x;
    for (const p of placed) {
      const end = p.n.beats + p.n.noteBeats;
      if (beats < end) return p.x + ((beats - p.n.beats) / p.n.noteBeats) * p.w;
    }
    return width - PAD_X;
  };

  return {
    markup: `<svg viewBox="0 0 ${width} 132" preserveAspectRatio="xMinYMid meet" style="width:${width}px;max-width:100%" role="img" aria-label="${measure.text}">${svg.join('')}</svg>`,
    beatsToX, width
  };
}

/* A miniature of the measure drawn on one scale shared by the whole
   sequence, so lengths and subdivision density stay comparable down the
   column. Tall marks sound, short ones are the silent notes of a figure. */
const MINI_PX = 26, MINI_H = 22;

function miniStrip(measure, longestBeats) {
  const marks = measure.notes.map(n => {
    const x = (n.beats * MINI_PX).toFixed(2);
    const cls = n.accent ? 'm-accent' : n.audible ? 'm-tick' : 'm-rest';
    const y = n.accent ? 2 : n.audible ? 6 : 12;
    return `<line class="${cls}" x1="${x}" y1="${y}" x2="${x}" y2="17"/>`;
  });

  let at = 0;
  measure.groups.forEach(g => {
    const x0 = at * MINI_PX;
    at += groupBeats(g);
    const x1 = at * MINI_PX - MINI_PX * 0.14;
    marks.push(`<line class="m-rule" x1="${x0.toFixed(2)}" y1="18.5" x2="${Math.max(x0 + 1, x1).toFixed(2)}" y2="18.5"/>`);
  });

  const pct = (measure.beats / longestBeats * 100).toFixed(2);
  return `<svg viewBox="0 0 ${measure.beats * MINI_PX} ${MINI_H}" preserveAspectRatio="none" ` +
         `style="width:${pct}%;height:${MINI_H}px" aria-hidden="true">${marks.join('')}</svg>`;
}

/* ---------- audio --------------------------------------- */

const A = {
  ctx: null,
  master: null,
  playing: false,
  timer: null,
  raf: null,
  lookahead: 0.12,
  tick: 25,
  plan: [],        // measure indices in range
  cursor: null,    // { slot, rep, pass, ni, measureStart }
  queue: [],
  nodes: [],
  endsAt: null,
  view: null       // measure currently drawn, with its start time
};

function audio() {
  if (!A.ctx) {
    A.ctx = new (window.AudioContext || window.webkitAudioContext)();
    A.master = A.ctx.createGain();
    A.master.gain.value = S.volume;
    A.master.connect(A.ctx.destination);
  }
  if (A.ctx.state === 'suspended') A.ctx.resume();
  return A.ctx;
}

function click(at, accent) {
  const ctx = A.ctx;
  const gain = ctx.createGain();
  const osc = ctx.createOscillator();
  const body = ctx.createOscillator();
  const bodyGain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.value = accent ? 1860 : 1180;
  body.type = 'triangle';
  body.frequency.value = accent ? 930 : 590;

  const peak = accent ? 1 : 0.55;
  const len = accent ? 0.075 : 0.05;

  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + len);
  bodyGain.gain.value = 0.32;

  osc.connect(gain);
  body.connect(bodyGain);
  bodyGain.connect(gain);
  gain.connect(A.master);

  osc.start(at); osc.stop(at + len + 0.02);
  body.start(at); body.stop(at + len + 0.02);
  A.nodes.push(osc, body);
  osc.onended = () => {
    A.nodes = A.nodes.filter(n => n !== osc && n !== body);
    try { gain.disconnect(); bodyGain.disconnect(); } catch (_) {}
  };
}

const playable = m => m && !m.error && m.notes.length > 0;

function buildPlan() {
  if (!S.seq) return [];
  const plan = [];
  for (let i = S.start - 1; i <= S.end - 1; i++) {
    if (playable(S.seq.measures[i])) plan.push(i);
  }
  return plan;
}

/* Eighth-note clicks ahead of the first measure — always eighths, whatever
   the measure is written in, since that is how you count a piece off. The
   count is short and its length is known, so the whole of it is scheduled in
   one go rather than through the lookahead loop; stop() silences these nodes
   like any other. Returns the time the music itself should begin. */
function countInTo(from) {
  if (!S.countIn) return from;
  const eighth = spb() / 2;
  for (let i = 0; i < S.countInEighths; i++) {
    const at = from + i * eighth;
    click(at, i === 0);
    A.queue.push({ at, count: i + 1 });
  }
  return from + S.countInEighths * eighth;
}

function play() {
  if (A.playing) return;
  const plan = buildPlan();
  if (!plan.length) {
    toast(S.seq ? 'Nothing playable in that range.' : 'Load a sequence first.', true);
    return;
  }
  audio();
  A.master.gain.value = S.volume;
  A.plan = plan;
  A.playing = true;
  A.queue = [];
  A.endsAt = null;
  A.view = null;
  A.cursor = { slot: 0, rep: 0, pass: 0, ni: 0, measureStart: countInTo(A.ctx.currentTime + 0.1) };
  A.timer = setInterval(schedule, A.tick);
  A.raf = requestAnimationFrame(frame);
  schedule();
  paintTransport();
}

function stop() {
  if (!A.playing && !A.timer) { paintTransport(); return; }
  A.playing = false;
  clearInterval(A.timer); A.timer = null;
  cancelAnimationFrame(A.raf); A.raf = null;
  A.nodes.forEach(n => { try { n.stop(); } catch (_) {} });
  A.nodes = [];
  A.queue = [];
  A.cursor = null;
  A.view = null;
  document.querySelectorAll('.measure.playing').forEach(el => el.classList.remove('playing'));
  paintTransport();
  showResting();
}

/* With the transport idle the stage previews whatever measure starts the range. */
function showResting() {
  const m = S.seq ? S.seq.measures[S.start - 1] : null;
  drawScore(m);
  paintNow(m);
}

const spb = () => 60 / S.bpm;

function schedule() {
  if (!A.playing) return;
  const now = A.ctx.currentTime;
  const horizon = now + A.lookahead;

  // The frame loop is suspended while the tab is hidden, so drop anything it
  // can no longer use rather than letting the queue grow without bound.
  while (A.queue.length && A.queue[0].at < now - 0.5) A.queue.shift();

  if (A.endsAt != null) {
    if (now >= A.endsAt) stop();
    return;
  }

  let guard = 0;
  while (A.playing && A.endsAt == null && guard++ < 512) {
    const m = S.seq.measures[A.plan[A.cursor.slot]];
    const note = m.notes[A.cursor.ni];
    const at = A.cursor.measureStart + note.beats * spb();
    if (at >= horizon) break;

    if (note.audible) click(at, note.accent);
    A.queue.push({
      at, ni: A.cursor.ni,
      measureIndex: m.index,
      rep: A.cursor.rep,
      pass: A.cursor.pass,
      measureStart: A.cursor.measureStart,
      audible: note.audible
    });
    advance(m);
  }
}

/* The first slot in the plan belonging to a phrase — where a repeat of the
   block starts again. A range that cuts into a phrase repeats the part of it
   that is in range, which is what you want when drilling a passage. */
function phraseHome(id) {
  for (let s = 0; s < A.plan.length; s++) {
    const ph = S.seq.measures[A.plan[s]].phrase;
    if (ph && ph.id === id) return s;
  }
  return null;
}

function advance(m) {
  const c = A.cursor;
  c.ni++;
  if (c.ni < m.notes.length) return;

  c.ni = 0;
  c.measureStart += m.beats * spb();
  c.rep++;
  if (c.rep < m.repeat) return;

  c.rep = 0;

  // at the end of a phrase, walk back to its head until the block has run
  if (m.phrase && m.phrase.last) {
    c.pass++;
    if (c.pass < m.phrase.repeat) {
      const home = phraseHome(m.phrase.id);
      if (home != null) { c.slot = home; return; }
    }
    c.pass = 0;
  }

  c.slot++;
  if (c.slot < A.plan.length) return;

  if (S.loop) { c.slot = 0; c.pass = 0; return; }
  A.endsAt = c.measureStart;   // let the last measure ring out, then halt
}

function frame() {
  if (!A.playing) return;
  const now = A.ctx.currentTime;

  while (A.queue.length && A.queue[0].at <= now) {
    const e = A.queue.shift();
    if (e.count) { paintCounting(e.count); continue; }
    if (e.ni === 0) {
      const m = S.seq.measures.find(x => x.index === e.measureIndex);
      if (!A.view || A.view.measureIndex !== e.measureIndex) drawScore(m);
      A.view = { measureIndex: e.measureIndex, start: e.measureStart, m };
      paintNow(m, e.rep, e.pass);
      markPlaying(e.measureIndex);
    } else if (A.view) {
      A.view.start = e.measureStart;
    }
    if (e.audible) flash(e.ni);
  }

  if (A.view && SCORE.beatsToX) {
    const beats = (now - A.view.start) / spb();
    const head = document.querySelector('#score .playhead line');
    if (head) {
      const x = SCORE.beatsToX(Math.max(0, Math.min(beats, A.view.m.beats)));
      head.setAttribute('x1', x); head.setAttribute('x2', x);
    }
  }

  if (A.endsAt != null && now >= A.endsAt) { stop(); return; }
  A.raf = requestAnimationFrame(frame);
}

function flash(ni) {
  const el = document.querySelector(`#score .note[data-i="${ni}"]`);
  if (!el) return;
  el.classList.remove('hit');
  void el.getBoundingClientRect();   // restart the strike animation
  el.classList.add('hit');
}

/* ---------- painting ------------------------------------ */

const SCORE = { beatsToX: null };

function drawScore(measure) {
  const host = $('score');
  const built = engrave(measure);
  host.dataset.measure = measure ? measure.index : '';
  if (!built) {
    host.innerHTML = `<p class="score-empty">${measure && measure.error ? 'Measure can’t be read' : 'No measure selected'}</p>`;
    SCORE.beatsToX = null;
    return;
  }
  host.innerHTML = built.markup;
  SCORE.beatsToX = built.beatsToX;
}

/* The count borrows the big figure; the notation underneath is left showing
   the measure about to start, which is what you want to be reading. */
function paintCounting(n) {
  $('stage').classList.add('counting');
  $('nowMeasure').textContent = n;
  $('nowRep').textContent = `count-in / ${S.countInEighths}`;
}

function paintNow(measure, rep, pass) {
  $('stage').classList.remove('counting');
  $('nowMeasure').textContent = measure ? measure.index : '—';
  $('nowNotation').textContent = measure ? measure.written : '';
  const r = $('nowRep');

  const parts = [];
  if (measure && measure.repeat > 1 && rep != null) {
    parts.push(`rep <b>${rep + 1}</b> / ${measure.repeat}`);
  }
  if (measure && measure.phrase && measure.phrase.repeat > 1 && pass != null) {
    parts.push(`phrase <b>${pass + 1}</b> / ${measure.phrase.repeat}`);
  }

  if (parts.length) {
    r.innerHTML = parts.join(' · ');
  } else if (measure && measure.label) {
    r.textContent = measure.label;
  } else {
    r.textContent = '';
  }
}

function markPlaying(index) {
  document.querySelectorAll('.measure.playing').forEach(el => el.classList.remove('playing'));
  const row = document.querySelector(`.measure[data-index="${index}"]`);
  // The row is highlighted but never scrolled to: yanking the page on every
  // new measure fights whoever is reading or scrolling the list.
  if (row) row.classList.add('playing');
}

function paintTransport() {
  const btn = $('play');
  btn.dataset.on = A.playing ? 'true' : 'false';
  btn.setAttribute('aria-label', A.playing ? 'Stop' : 'Play');
  $('playIcon').setAttribute('d', A.playing ? 'M6.5 6.5h11v11h-11Z' : 'M8 5.5 19 12 8 18.5Z');
  btn.disabled = !S.seq;
  $('loopBtn').setAttribute('aria-pressed', S.loop ? 'true' : 'false');
  $('countBtn').setAttribute('aria-pressed', S.countIn ? 'true' : 'false');
  $('countN').disabled = !S.countIn;
}

function paintPicker() {
  const sel = $('seqPick');
  sel.innerHTML = '';

  const bucket = origin => S.files.filter(f => f.origin === origin);
  const fill = (parent, files) => files.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.seq.title;
    opt.selected = f.id === S.activeId;
    parent.appendChild(opt);
  });

  const folder = bucket('folder'), opened = bucket('opened');
  if (!folder.length && !opened.length) {
    const opt = document.createElement('option');
    opt.textContent = 'No sequences';
    opt.value = '';
    sel.appendChild(opt);
    sel.disabled = true;
  } else {
    sel.disabled = false;
    if (folder.length && opened.length) {
      const a = document.createElement('optgroup'); a.label = 'In this folder';
      fill(a, folder); sel.appendChild(a);
      const b = document.createElement('optgroup'); b.label = 'Opened';
      fill(b, opened); sel.appendChild(b);
    } else {
      fill(sel, folder.length ? folder : opened);
    }
  }

  const active = S.files.find(f => f.id === S.activeId);
  $('forgetBtn').hidden = !active || active.origin !== 'opened';
}

function paintList() {
  const ol = $('measures');
  ol.innerHTML = '';
  $('empty').style.display = S.seq ? 'none' : '';
  if (!S.seq) {
    $('seqTitle').textContent = 'No sequence';
    $('seqMeta').textContent = '';
    return;
  }

  const ms = S.seq.measures;
  const played = ms.slice(S.start - 1, S.end)
    .reduce((a, m) => a + m.repeat * (m.phrase ? m.phrase.repeat : 1), 0);
  $('seqTitle').textContent = S.seq.title;
  $('seqMeta').textContent = `${ms.length} measures · range plays ${played}`;

  const longest = ms.reduce((a, m) => Math.max(a, m.beats), 0) || 1;

  ms.forEach(m => {
    const li = document.createElement('li');
    li.className = 'measure';
    li.dataset.index = m.index;
    const inRange = m.index >= S.start && m.index <= S.end;
    li.classList.add(inRange ? 'in' : 'out');
    if (m.index === S.start) li.classList.add('range-start');
    if (m.index === S.end) li.classList.add('range-end');
    if (m.error) li.classList.add('bad');

    const ph = m.phrase;
    if (ph && ph.repeat > 1) {
      li.classList.add('ph');
      if (ph.first) li.classList.add('ph-start');
      if (ph.last) li.classList.add('ph-end');
    }

    li.innerHTML =
      `<span class="gutter"></span>` +
      `<span class="idx">${m.index}</span>` +
      `<span class="m-notation">${m.label ? `<span class="mark">${escapeHtml(m.label)}</span>` : ''}${escapeHtml(m.written)}</span>` +
      `<span class="ministrip">${m.error ? '' : miniStrip(m, longest)}</span>` +
      `<span class="reps">${m.repeat > 1 ? `<b>×${m.repeat}</b>` : ''}` +
      `${ph && ph.repeat > 1 && ph.last ? `<i class="ph-count">×${ph.repeat}</i>` : ''}</span>`;

    if (m.error) li.title = m.error;
    else if (ph && ph.repeat > 1) li.title = `${ph.size}-measure phrase, played ${ph.repeat} times`;

    li.addEventListener('click', ev => {
      if (ev.shiftKey) {
        S.end = Math.max(m.index, S.start);
      } else {
        S.start = m.index;
        if (S.end < S.start) S.end = S.start;
      }
      syncRangeInputs();
      paintList();
      if (!A.playing) showResting();
      save();
    });

    ol.appendChild(li);
  });
}

function syncRangeInputs() {
  const n = S.seq ? S.seq.measures.length : 1;
  const s = $('startM'), e = $('endM');
  s.max = n; e.max = n;
  s.value = S.start; e.value = S.end;
}

function paintAll() {
  paintPicker();
  paintList();
  syncRangeInputs();
  paintTransport();
  $('bpm').value = S.bpm;
  $('bpmRange').value = S.bpm;
  $('vol').value = Math.round(S.volume * 100);
  $('countN').value = S.countInEighths;
  if (!A.playing) showResting();
}

const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let toastTimer;
function toast(message, fault) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('fault', !!fault);
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 4200);
}

/* ---------- files in --------------------------------------- */

function removeFile(id) {
  S.files = S.files.filter(f => f.id !== id);
  if (S.activeId === id) {
    stop();
    S.activeId = null;
    S.seq = null;
    if (S.files.length) selectFile(S.files[0].id);
  }
  paintAll();
  save();
}

async function ingest(fileList) {
  const files = Array.from(fileList).filter(f => /\.json$/i.test(f.name) || f.type === 'application/json');
  if (!files.length) { toast('Loops reads .json files.', true); return; }

  let last = null, faults = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(await f.text());
      last = addFile(f.name, raw, 'opened');
    } catch (err) {
      faults.push(`${f.name}: ${err.message}`);
    }
  }
  if (last) selectFile(last.id, { adoptTempo: true });
  paintAll();
  save();

  if (faults.length) toast(faults[0], true);
  else if (last) {
    const bad = last.seq.measures.filter(m => m.error);
    if (bad.length) toast(`Measure ${bad[0].index} — ${bad[0].error}`, true);
    else toast(`${last.seq.title} loaded — ${last.seq.measures.length} measures.`);
  }
}

/* ---------- wiring ---------------------------------------- */

function setTempo(v) {
  S.bpm = clamp(Math.round(v), 20, 300);
  $('bpm').value = S.bpm;
  $('bpmRange').value = S.bpm;
  save();
}

async function init() {
  restorePrefs();
  paintAll();
  wire();
  await loadLibrary();
  chooseInitial();
  paintAll();
}

function wire() {
  $('play').addEventListener('click', () => (A.playing ? stop() : play()));

  $('seqPick').addEventListener('change', e => {
    selectFile(e.target.value);
    paintAll();
    save();
  });

  $('forgetBtn').addEventListener('click', () => {
    if (S.activeId) removeFile(S.activeId);
  });

  $('bpm').addEventListener('input', e => setTempo(e.target.value));
  $('bpmRange').addEventListener('input', e => setTempo(e.target.value));

  $('vol').addEventListener('input', e => {
    S.volume = e.target.value / 100;
    if (A.master) A.master.gain.value = S.volume;
    save();
  });

  $('startM').addEventListener('change', e => {
    if (!S.seq) return;
    S.start = clamp(e.target.value, 1, S.seq.measures.length);
    if (S.end < S.start) S.end = S.start;
    syncRangeInputs(); paintList();
    if (!A.playing) showResting();
    save();
  });

  $('endM').addEventListener('change', e => {
    if (!S.seq) return;
    S.end = clamp(e.target.value, S.start, S.seq.measures.length);
    syncRangeInputs(); paintList(); save();
  });

  $('loopBtn').addEventListener('click', () => {
    S.loop = !S.loop;
    paintTransport();
    save();
  });

  $('countBtn').addEventListener('click', () => {
    S.countIn = !S.countIn;
    paintTransport();
    save();
  });

  $('countN').addEventListener('change', e => {
    S.countInEighths = clamp(e.target.value, 1, 16);
    e.target.value = S.countInEighths;
    save();
  });

  $('fileInput').addEventListener('change', e => { ingest(e.target.files); e.target.value = ''; });
  document.querySelector('label.btn').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileInput').click(); }
  });

  $('formatBtn').addEventListener('click', () => $('formatDlg').showModal());

  $('loadExamples').addEventListener('click', () => {
    let first = null;
    EXAMPLES.forEach(ex => { const f = addFile(ex.name, ex.body, 'opened'); if (!first) first = f; });
    selectFile(first.id, { adoptTempo: true });
    paintAll();
    save();
    toast('Examples loaded.');
  });

  let dragDepth = 0;
  window.addEventListener('dragenter', e => {
    e.preventDefault();
    if (++dragDepth === 1) $('dropzone').classList.add('on');
  });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) { dragDepth = 0; $('dropzone').classList.remove('on'); }
  });
  window.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    $('dropzone').classList.remove('on');
    if (e.dataTransfer && e.dataTransfer.files.length) ingest(e.dataTransfer.files);
  });

  window.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    // leave Space alone on buttons so they still activate from the keyboard
    const onControl = typing || e.target.tagName === 'BUTTON';
    if (e.code === 'Space' && !onControl) {
      e.preventDefault();
      A.playing ? stop() : play();
    } else if (!typing && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      setTempo(S.bpm + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 5 : 1));
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
