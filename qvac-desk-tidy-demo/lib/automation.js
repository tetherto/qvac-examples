// Automation manager: turns each managed folder's trigger into calls to a single runFolder(rule)
// callback. Two triggers fire automatically:
//   - interval: a timer every rule.intervalMinutes.
//   - watch: chokidar on the folder (top level only), with awaitWriteFinish so a still-downloading
//            file settles before we react. New/changed files are debounced into one run.
// "manual" folders are just remembered; they never fire on their own.
//
// This module owns NO model or filesystem-move logic: it only decides WHEN to run. The callback
// (in main.js) does the classify/plan and honours the folder's posture (notify vs auto).
"use strict";
const chokidar = require("chokidar");

class Automation {
  constructor(runFolder) {
    this.runFolder = runFolder;   // async (rule, { reason }) => void
    this.timers = new Map();      // path -> interval handle
    this.watchers = new Map();    // path -> { watcher, pending, debounce }
    this.paused = false;
    this.pauseUntil = 0;
  }

  isPaused() { if (this.paused && this.pauseUntil && Date.now() > this.pauseUntil) { this.paused = false; } return this.paused; }
  pauseFor(ms) { this.paused = true; this.pauseUntil = Date.now() + ms; }
  resume() { this.paused = false; this.pauseUntil = 0; }

  // (Re)apply all rules: start timers/watchers for interval/watch folders, stop the rest.
  sync(folders) {
    const wanted = new Map(folders.map((f) => [f.path, f]));
    for (const p of [...this.timers.keys()]) if (!wanted.has(p) || wanted.get(p).trigger !== "interval") this._stopTimer(p);
    for (const p of [...this.watchers.keys()]) if (!wanted.has(p) || wanted.get(p).trigger !== "watch") this._stopWatch(p);
    for (const rule of folders) {
      if (rule.trigger === "interval") this._startTimer(rule);
      else if (rule.trigger === "watch") this._startWatch(rule);
    }
  }

  _fire(rule, reason) { if (this.isPaused()) return; Promise.resolve(this.runFolder(rule, { reason })).catch((e) => console.error("[automation] run failed:", e.message)); }

  _startTimer(rule) {
    // Floor is 1 second, not 1 minute, so a fractional intervalMinutes stays usable in tests. Real
    // settings (15 / 60 / 1440) are unaffected.
    const ms = Math.max(1000, (rule.intervalMinutes || 60) * 60 * 1000);
    const existing = this.timers.get(rule.path);
    // Same cadence: adopt the new rule and LEAVE THE TIMER RUNNING. Restarting on every sync() would
    // reset the countdown, so a folder on a 60-minute timer could keep being pushed back and never fire.
    if (existing && existing.ms === ms) { existing.rule = rule; return; }
    this._stopTimer(rule.path);
    const state = { ms, rule, handle: null };
    state.handle = setInterval(() => this._fire(state.rule, "interval"), ms);
    this.timers.set(rule.path, state);
  }
  _stopTimer(p) { const t = this.timers.get(p); if (t) { clearInterval(t.handle); this.timers.delete(p); } }

  _startWatch(rule) {
    // Already watching: keep the watcher but ADOPT THE NEW RULE. The fire closure reads state.rule, so
    // editing a folder's posture or threshold takes effect immediately. (Before this, the closure kept
    // the rule captured at watch time, so switching notify -> auto silently did nothing until restart.)
    const existing = this.watchers.get(rule.path);
    if (existing) { existing.rule = rule; return; }
    const w = chokidar.watch(rule.path, {
      depth: 0,                                 // top-level only, like the manual scan
      ignoreInitial: true,                      // do not fire for files already there
      awaitWriteFinish: { stabilityThreshold: 3000, pollInterval: 300 }, // let downloads finish
      ignored: (p) => path_basename(p).startsWith("."),
    });
    const state = { watcher: w, debounce: null, rule };
    const onChange = () => {
      clearTimeout(state.debounce);
      // fire with state.rule, never the captured `rule`, so a live edit is honoured
      state.debounce = setTimeout(() => this._fire(state.rule, "watch"), 1500); // coalesce a burst into one run
    };
    w.on("add", onChange).on("change", onChange);
    this.watchers.set(rule.path, state);
  }
  _stopWatch(p) { const s = this.watchers.get(p); if (s) { try { s.watcher.close(); } catch { /* */ } clearTimeout(s.debounce); this.watchers.delete(p); } }

  stopAll() { for (const p of [...this.timers.keys()]) this._stopTimer(p); for (const p of [...this.watchers.keys()]) this._stopWatch(p); }
}

function path_basename(p) { const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")); return i >= 0 ? p.slice(i + 1) : p; }

module.exports = { Automation };
