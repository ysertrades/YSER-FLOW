import { useState, useEffect, useMemo } from "react";

/* ---------------------------------------------------------------------------
 * The ET clock and the session windows.
 *
 * This used to live inside Calculator.jsx. Two surfaces need it now — the
 * calculator's four session blocks and the Sessions dial — so it lives here and
 * both import it. Nothing about the behaviour changed in the move.
 * ------------------------------------------------------------------------- */

const ET_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  weekday: "short",
});
const WEEKDAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/* `at` exists so this is testable. Everything downstream is a pure function of
 * the current ET instant, which means the only way to check the Friday-close or
 * Sunday-open edges without it is to run the suite at exactly the right moment
 * on the right day of the week. */
export function getEtNow(at = new Date()) {
  const parts = ET_FORMATTER.formatToParts(at);
  const map = {};
  parts.forEach((p) => (map[p.type] = p.value));
  const hours = parseInt(map.hour, 10) % 24;
  const minutes = parseInt(map.minute, 10);
  const seconds = parseInt(map.second, 10);
  const day = WEEKDAY_MAP[map.weekday];
  return { hours, minutes, seconds, day, totalMinutes: hours * 60 + minutes };
}

export const WEEK_MINUTES = 10080;
export const FRI_START = 4 * 1440 + 17 * 60; // Friday 5:00 PM (Mon-indexed, Fri = day 4)
export const SUN_END = 6 * 1440 + 18 * 60;   // Sunday 6:00 PM (Sun = day 6)

export function toLinear(day, minutes) {
  const mondayIndex = (day + 6) % 7; // Mon=0 ... Sun=6
  return mondayIndex * 1440 + minutes;
}

// Daily session (Asia/London/NY): active at its normal time on any weekday,
// but any occurrence that falls inside the Fri 5pm–Sun 6pm weekend blackout
// is dropped entirely, so it only resumes at its default time from
// Sunday 6pm onward (or on ordinary weekdays).
export function dailyStatusWeekAware(linearNow, startMin, endMin) {
  const occurrences = [];
  for (let d = 0; d < 7; d++) {
    const s = d * 1440 + startMin;
    const e = d * 1440 + endMin;
    const overlapsBlackout = s < SUN_END && e > FRI_START;
    if (!overlapsBlackout) occurrences.push({ start: s, end: e });
  }
  // Mirror across the previous/next week so "current" and "next" are always found.
  const extended = [
    ...occurrences.map((o) => ({ start: o.start - WEEK_MINUTES, end: o.end - WEEK_MINUTES })),
    ...occurrences,
    ...occurrences.map((o) => ({ start: o.start + WEEK_MINUTES, end: o.end + WEEK_MINUTES })),
  ];

  const current = extended.find((o) => linearNow >= o.start && linearNow < o.end);
  if (current) return { status: "open", remaining: current.end - linearNow };

  const next = extended.filter((o) => o.start > linearNow).sort((a, b) => a.start - b.start)[0];
  return { status: "closed", remaining: next ? next.start - linearNow : 0 };
}

export function weekendStatus(linearNow) {
  if (linearNow >= FRI_START && linearNow < SUN_END) {
    return { status: "open", remaining: SUN_END - linearNow };
  }
  let remaining;
  if (linearNow < FRI_START) remaining = FRI_START - linearNow;
  else remaining = FRI_START + WEEK_MINUTES - linearNow;
  return { status: "closed", remaining };
}

export function fmtRemaining(mins) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function fmtClock(hours, minutes) {
  return `ET ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/* ---------------------------------------------------------------------------
 * The windows.
 *
 * SESSIONS is the outer ring and the calculator's four blocks — the same array
 * that has always driven them. SUB holds a window that sits INSIDE one of those
 * rather than beside it: the silver bullet is an hour within the NY killzone,
 * so it cannot share the ring without one hiding the other, and it is drawn on
 * its own inner ring and nested under its parent in the list.
 *
 * Changing which windows you trade is an edit to these two arrays and nothing
 * else. `parent` must match a SESSIONS `name` exactly.
 * ------------------------------------------------------------------------- */
export const DAILY_SESSIONS = [
  { key: "asia", name: "Asia Range", start: 1200, end: 1440, range: "8 PM–12 AM" },
  { key: "london", name: "London Killzone", start: 120, end: 300, range: "2 AM–5 AM" },
  { key: "ny", name: "NY Killzone", start: 570, end: 660, range: "9:30 AM–11 AM" },
];

export const RING_SESSIONS = [
  { key: "asia",   name: "Asia Range",      start: 1200, end: 1440, at: "8:00 PM" },
  { key: "london", name: "London Killzone", start: 120,  end: 300,  at: "2:00 AM" },
  { key: "ny",     name: "NY Killzone",     start: 570,  end: 660,  at: "9:30 AM" },
  { key: "pm",     name: "PM Session",      start: 900,  end: 960,  at: "3:00 PM" },
];

export const SUB_WINDOWS = [
  { key: "sb", name: "Silver Bullet", start: 600, end: 660, at: "10:00 AM", parent: "NY Killzone" },
];

/* Instants rather than windows — drawn as a tick across both rings. */
export const MARKS = [
  { key: "midnight", name: "Midnight open", minute: 0 },
  { key: "lo",       name: "London open",   minute: 180 },
  { key: "nyo",      name: "NY open",       minute: 570 },
];

/* ---------------------------------------------------------------------------
 * The tick.
 *
 * One shared hook so the calculator and the dial cannot drift a second apart.
 * It re-renders on the second boundary rather than every 1000ms from mount, so
 * the displayed minute turns over when the clock does.
 * ------------------------------------------------------------------------- */
export function useEtTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    let timeoutId;
    const scheduleNextTick = () => {
      const msIntoSecond = Date.now() % 1000;
      const delay = 1000 - msIntoSecond;
      timeoutId = setTimeout(() => {
        setTick((t) => t + 1);
        scheduleNextTick();
      }, delay);
    };
    scheduleNextTick();
    return () => clearTimeout(timeoutId);
  }, []);
}

export function useClockAndSessions() {
  useEtTick();

  const { hours, minutes, day, totalMinutes } = getEtNow();
  const linearNow = toLinear(day, totalMinutes);

  return useMemo(() => {
    const sessions = [
      ...DAILY_SESSIONS.map((s) => ({ ...s, ...dailyStatusWeekAware(linearNow, s.start, s.end) })),
      { key: "weekend", name: "Weekend", range: "Fri 5 PM–Sun 6 PM", ...weekendStatus(linearNow) },
    ];
    return { clockLabel: fmtClock(hours, minutes), sessions };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours, minutes, linearNow]);
}

/* ---------------------------------------------------------------------------
 * Everything the dial needs, for a given ET instant.
 *
 * Pure: pass a Date and get the whole screen's state back. That is what makes
 * the dial and the list provably agree — they read the same object rather than
 * each working it out.
 * ------------------------------------------------------------------------- */
export function readDay(at = new Date()) {
  const { hours, minutes, day, totalMinutes } = getEtNow(at);
  const linearNow = toLinear(day, totalMinutes);
  const closed = weekendStatus(linearNow).status === "open"; // "weekend open" = market shut

  const state = (w) => {
    if (closed) return "done";
    if (totalMinutes >= w.start && totalMinutes < w.end) return "open";
    return totalMinutes < w.start ? "ahead" : "done";
  };

  const decorate = (w) => ({
    ...w,
    state: state(w),
    remaining: w.end - totalMinutes,
    until: w.start - totalMinutes,
  });

  const ring = RING_SESSIONS.map(decorate);
  const sub = SUB_WINDOWS.map(decorate);

  const upcoming = [...ring, ...sub]
    .filter((w) => w.state === "ahead")
    .sort((a, b) => a.start - b.start);

  const openRing = ring.find((w) => w.state === "open") || null;
  const openSub = sub.find((w) => w.state === "open") || null;

  return {
    hours, minutes, day, totalMinutes, linearNow, closed,
    ring, sub, upcoming,
    nextKey: upcoming.length ? upcoming[0].key : null,
    openRing, openSub,
    // the headline window: the session if one is running, otherwise the sub
    primary: openRing || openSub,
    reopenIn: closed ? weekendStatus(linearNow).remaining : 0,
  };
}
