"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import type { AdminEventLevel } from "@/lib/db/schema/admin";

/**
 * How the dashboard gets your attention from across the room.
 *
 * Three channels per kind of event — a pop-up in the page, a sound, and a
 * desktop notification (which reaches a second monitor, or a game in front of
 * it). What's on is remembered by this browser.
 *
 * **The sounds are synthesised**, not files: a bright three-note run for money,
 * a two-note chime for a milestone, a low double knock for a problem. Browsers
 * only let a page make sound after it's been clicked, hence "Turn sound on".
 */

export type AlertChannel = "toast" | "sound" | "desktop";
export type AlertPrefs = Record<AdminEventLevel, Record<AlertChannel, boolean> & { volume: number }>;

export const DEFAULT_PREFS: AlertPrefs = {
  money: { volume: 1, toast: true, sound: true, desktop: true },
  milestone: { volume: 1, toast: true, sound: true, desktop: true },
  problem: { volume: 1, toast: true, sound: true, desktop: false },
  activity: { volume: 1, toast: false, sound: false, desktop: false },
};

const KEY = "admin:alert-prefs";
const CHANGED = "admin:alert-prefs:changed";
let memoryPrefs = "";

export function useAlertPrefs(): readonly [AlertPrefs, (next: AlertPrefs) => void] {
  const raw = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("storage", onChange);
      window.addEventListener(CHANGED, onChange);
      return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(CHANGED, onChange);
      };
    },
    () => {
      try {
        return window.localStorage.getItem(KEY) ?? memoryPrefs;
      } catch {
        return memoryPrefs;
      }
    },
    () => ""
  );

  const prefs = useMemo<AlertPrefs>(() => {
    try {
      const saved = raw ? JSON.parse(raw) : {};
      return Object.fromEntries(Object.entries(DEFAULT_PREFS).map(([level, defaults]) => {
        const value = saved?.[level];
        return [level, { ...defaults,
          ...Object.fromEntries((["toast", "sound", "desktop"] as const).map(key => [key, typeof value?.[key] === "boolean" ? value[key] : defaults[key]])),
          volume: typeof value?.volume === "number" && Number.isFinite(value.volume) ? Math.max(0, Math.min(1, value.volume)) : 1,
        }];
      })) as AlertPrefs;
    } catch {
      return DEFAULT_PREFS;
    }
  }, [raw]);

  const set = useCallback((next: AlertPrefs) => {
    memoryPrefs = JSON.stringify(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Blocked storage — it holds until the page is closed.
    }
    window.dispatchEvent(new Event(CHANGED));
  }, []);

  return [prefs, set] as const;
}

/* ── Sound ────────────────────────────────────────────────────────────── */

let audio: AudioContext | null = null;

/** Called from a click, which is the only time a browser allows it. */
export function unlockSound() {
  audio ??= new AudioContext();
  void audio.resume();
  return audio.state !== "closed";
}

export function soundReady() {
  return audio !== null && audio.state === "running";
}

const TUNES: Record<AdminEventLevel, { freq: number; at: number; length: number; type: OscillatorType; gain: number }[]> = {
  // Cha-ching: a quick bright run up, the last note held.
  money: [
    { freq: 1318.5, at: 0, length: 0.09, type: "triangle", gain: 0.22 },
    { freq: 1760, at: 0.08, length: 0.09, type: "triangle", gain: 0.22 },
    { freq: 2637, at: 0.16, length: 0.5, type: "triangle", gain: 0.2 },
    { freq: 3951, at: 0.18, length: 0.35, type: "sine", gain: 0.06 },
  ],
  milestone: [
    { freq: 880, at: 0, length: 0.18, type: "sine", gain: 0.2 },
    { freq: 1318.5, at: 0.14, length: 0.4, type: "sine", gain: 0.18 },
  ],
  problem: [
    { freq: 196, at: 0, length: 0.14, type: "square", gain: 0.08 },
    { freq: 196, at: 0.2, length: 0.14, type: "square", gain: 0.08 },
  ],
  activity: [{ freq: 1046.5, at: 0, length: 0.06, type: "sine", gain: 0.06 }],
};

export function playSound(level: AdminEventLevel, volume = 1) {
  if (!audio || audio.state !== "running") return;
  const levelVolume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
  if (levelVolume === 0) return;
  const now = audio.currentTime;
  for (const note of TUNES[level]) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = note.type;
    osc.frequency.value = note.freq;
    gain.gain.setValueAtTime(0.0001, now + note.at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, note.gain * levelVolume), now + note.at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + note.at + note.length);
    osc.connect(gain).connect(audio.destination);
    osc.start(now + note.at);
    osc.stop(now + note.at + note.length + 0.05);
  }
}

/* ── Desktop notifications ────────────────────────────────────────────── */

export function desktopPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

export async function askDesktopPermission() {
  if (typeof Notification === "undefined") return "unsupported" as const;
  return Notification.requestPermission();
}

export function notifyDesktop(title: string, body: string, tag: string) {
  if (desktopPermission() !== "granted") return;
  try {
    const note = new Notification(title, { body, tag, silent: true });
    note.onclick = () => {
      window.focus();
      note.close();
    };
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}
