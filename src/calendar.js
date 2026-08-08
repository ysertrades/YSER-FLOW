/* ---------------------------------------------------------------------------
 * The economic calendar.
 *
 * ForexFactory's weekly JSON, via faireconomy.media. Free, keyless, no account,
 * and — unlike a news wire — it is a SCHEDULE: it knows what is coming, not
 * just what happened. That is the whole reason this replaced the newswire. A
 * headline tells you something moved after it moved; a calendar tells you at
 * 8:29 that you have sixty seconds.
 *
 * Two fields do the filtering and they are the two you asked for: `country`,
 * which is a currency code, and `impact`. US high-impact is country USD and
 * impact High, and everything else is dropped before it reaches the screen.
 *
 * NOT VERIFIED AGAINST THE LIVE HOST. This environment blocks all outbound
 * traffic, so the shape below is from the feed's documented form rather than a
 * capture. Everything is therefore read defensively: a missing field is a
 * missing field and not a crash, unparseable dates drop the row rather than
 * rendering "Invalid Date", and both the array-at-top-level and
 * wrapped-in-an-object shapes are accepted.
 * ------------------------------------------------------------------------- */

import { getEtNow, toLinear, SUN_END, WEEK_MINUTES } from "./sessions";

/* SAME ORIGIN, AND THAT IS THE WHOLE FIX.
 *
 * This used to ask nfs.faireconomy.media directly, on the theory that the
 * question — does that host send Access-Control-Allow-Origin — could only be
 * answered on a real device. It was, and the answer is no: Safari reported
 * "Load failed", which is what it says when it REFUSES a response, not when a
 * server rejects one.
 *
 * So the request does not cross an origin any more. The feed is fetched on a
 * GitHub Actions runner at build time and shipped in public/ as part of the
 * site — see .github/workflows/deploy.yml. A page fetching a file from the
 * host that served it has no CORS check to fail, no preflight, no key and no
 * proxy to keep running.
 *
 * What it costs is freshness on ONE field. The week's schedule is fixed days
 * ahead and is always right; `actual` — the number that lands at the moment of
 * a release — is as old as the last build, up to the workflow's fifteen-minute
 * cron. If you want that live to the second, deploy worker/calendar.js and
 * point the meta below at it; this file becomes the fallback and nothing else
 * changes. */
const SAME_ORIGIN = "calendar.json";

/* Optionally overridden in index.html:
 *
 *     <meta name="cal-feed" content="https://yser-cal.<you>.workers.dev">
 *
 * for the live-to-the-second version. Unset, the built-in copy is used. */
const META = (typeof document !== "undefined"
  && document.querySelector('meta[name="cal-feed"]')?.content) || "";

export const CAL_URL = META || SAME_ORIGIN;
export const CAL_CONFIGURED = Boolean(META);

/* THE WEEK AFTER, FETCHED TOO, AND ALLOWED TO BE MISSING.
 *
 * The trading week runs Sunday 6 PM to Sunday 6 PM; the feed's file runs
 * Sunday midnight to Saturday midnight. Those do not line up, and the gap sits
 * exactly on the evening the new week is supposed to appear. If FF ever rolls
 * its file late — an hour after our window has already advanced is enough —
 * Sunday evening would show an empty week with no way to tell that from a
 * genuinely quiet one.
 *
 * So the next week's file is fetched as well and merged in. Every event lands
 * in the same pool and weekAhead() decides what is in range, which means the
 * two files never need to be told apart. It is best-effort by design: a 404
 * here is silence, not a failure, because the primary file covers the normal
 * case entirely on its own. */
const SAME_ORIGIN_NEXT = "calendar-next.json";
export const CAL_URL_NEXT = CAL_CONFIGURED ? "" : SAME_ORIGIN_NEXT;

/* NOBODY GIVES UP ANY MORE. The give-up existed for probing a foreign host
   that might never be allowed through, where retrying every twenty seconds
   forever was pure waste. A same-origin file is either there or the site is
   broken, so a failure here is transient by definition and worth retrying —
   the backoff below is enough to keep it cheap. */
export const CAL_GIVE_UP = 0;

/* A WEEK OF EVENTS DOES NOT CHANGE EVERY TWENTY SECONDS. The schedule is fixed
   days ahead; the only thing that moves is `actual`, which appears the moment a
   number is released. Sixty seconds is quick enough that a print shows up while
   you are still looking at the screen, and slow enough to be invisible to
   whoever is paying for the bandwidth. */
export const CAL_POLL_MS = (typeof document !== "undefined"
  && Number(document.querySelector('meta[name="cal-poll"]')?.content)) || 60000;

const ET = "America/New_York";
const str = (v) => (typeof v === "string" ? v.trim() : "");

/* ── WHEN A WEEK STARTS ─────────────────────────────────────────────────────
 *
 * Sunday 6:00 PM ET, which is not a number invented here: it is SUN_END from
 * sessions.js, the same boundary the dial counts down to while the market is
 * shut. Importing it rather than writing 18 * 60 again is the whole point —
 * two surfaces on the same tab disagreeing about which week it is would be
 * worse than either of them being wrong alone.
 *
 * This also answers the feed's rollover on its own. FF's week begins at
 * Sunday MIDNIGHT, so for eighteen hours the file already holds the coming
 * week while the market is still closed. The window below is what holds those
 * events back until the week has actually opened.
 * ------------------------------------------------------------------------ */
const WEEK_MS = WEEK_MINUTES * 60000;

/** The instant the current trading week opened: the last Sunday 6 PM ET. */
export function weekOpenAt(now = Date.now()) {
  const et = getEtNow(new Date(now));
  const linear = toLinear(et.day, et.totalMinutes);
  /* Minutes since the most recent Sunday 18:00, wrapping the week. A modulo
     rather than a branch, so Sunday afternoon — which belongs to the week that
     is ending, not the one about to open — needs no special case. */
  const since = (linear - SUN_END + WEEK_MINUTES) % WEEK_MINUTES;
  return now - (since * 60000 + et.seconds * 1000 + (now % 1000));
}

/** When it closes, which is the same instant the next one opens. */
export function weekCloseAt(now = Date.now()) {
  return weekOpenAt(now) + WEEK_MS;
}

/* How long a released event stays on the card after it fires.
 *
 * NOT ZERO, and this is the one place the card looks backwards on purpose.
 * Dropping a row the instant its clock reaches zero means the number you were
 * waiting for is never on screen at all — and with the feed fetched at build
 * time, `actual` can arrive a quarter of an hour after the release, by which
 * point a zero-hold card has already forgotten the event existed.
 *
 * An hour catches the print and leaves time to read it, and is short enough
 * that the list is visibly draining rather than accumulating: by Thursday
 * nothing from Monday is on screen. */
export const DONE_HOLD_MS = 60 * 60 * 1000;

/* Empty is a real answer from this feed and must survive as one: FF publishes
   "" for a forecast that does not exist, and the row should show a dash rather
   than the word undefined. */
const val = (v) => {
  const s = str(v);
  return s && s !== "N/A" ? s : null;
};

/**
 * The raw feed -> US high-impact events, soonest first.
 *
 * Ascending, which is the opposite of the wire and is the point: a calendar is
 * read forwards. The next thing is the thing you care about.
 */
export function parseCalendar(raw) {
  /* The feed is a bare array. Accepting an object wrapper too costs one line
     and covers the case where they ever wrap it — a shape change that would
     otherwise present as "no events this week", which is indistinguishable from
     a quiet week and therefore the worst possible failure for a calendar. */
  const list = Array.isArray(raw) ? raw
    : Array.isArray(raw?.events) ? raw.events
    : Array.isArray(raw?.data) ? raw.data
    : null;
  if (!list) throw new Error("calendar is not a list of events");

  /* US AND HIGH, MATCHED LOOSELY ON PURPOSE.
   *
   * An exact === on both fields is the obvious way to write this and the wrong
   * one here, because the live strings have never been seen from this side and
   * the failure is SILENT: a feed that says "High Impact Expected" instead of
   * "High", or "US" instead of "USD", produces zero matches — and zero matches
   * renders as "No high-impact US events this week", which is a real and
   * plausible answer. The card would look calm and be lying.
   *
   * So the country accepts either spelling, and the impact matches on its
   * leading word. Nothing else this feed publishes begins with "high" — the
   * levels are High, Medium, Low and Holiday — so there is no loosening of what
   * gets through, only of how it may be spelled. */
  return list
    .filter((e) => {
      const c = str(e?.country).toUpperCase();
      return (c === "USD" || c === "US")
        && str(e?.impact).toLowerCase().startsWith("high");
    })
    .map((e) => {
      const at = Date.parse(str(e.date));
      if (!Number.isFinite(at)) return null;
      const title = str(e.title);
      if (!title) return null;
      return {
        /* No id in the feed, so one is made from the two things that identify
           an event: what it is and when. Stable across polls, which is what
           lets the card tell an updated `actual` from a new row. */
        id: `${at}:${title}`,
        title, at,
        forecast: val(e.forecast),
        previous: val(e.previous),
        /* Present only after the release. Its arrival is the single most
           interesting thing this feed does. */
        actual: val(e.actual),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.at - b.at);
}

/* A calendar figure as a number, so an actual can be compared with its forecast.
 *
 * These arrive as display strings — "185K", "0.3%", "-1.2%", "4.50%", "3.1M" —
 * so the suffix carries a magnitude that has to be honoured or 185K reads as
 * smaller than 0.3. Anything that does not contain a number at all (a speech,
 * a statement) returns null and is simply not compared. */
export function figure(s) {
  if (!s) return null;
  const t = String(s).replace(/,/g, "").trim();
  const m = t.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  let v = parseFloat(m[0]);
  if (/k\b/i.test(t)) v *= 1e3;
  else if (/m\b/i.test(t)) v *= 1e6;
  else if (/b\b/i.test(t)) v *= 1e9;
  return Number.isFinite(v) ? v : null;
}

/**
 * Did it come in above or below what was expected?
 *
 *   1 above · -1 below · 0 in line · null not comparable
 *
 * ABOVE AND BELOW, NOT GOOD AND BAD, and that distinction is the reason this
 * returns a direction rather than a sentiment. A hot CPI and a hot payrolls
 * print are both "above forecast" and they mean opposite things for the same
 * trade; deciding which is good is the reader's job and the calendar has no
 * business guessing at it. The arrow says which way it missed and the forecast
 * sits next to it, which is all the information there is.
 */
export function surprise(actual, forecast) {
  const a = figure(actual);
  const f = figure(forecast);
  if (a === null || f === null) return null;
  if (a === f) return 0;
  return a > f ? 1 : -1;
}

/* Everything below reads the clock in ET, because every other clock on this tab
   is ET and a calendar quietly using the device's timezone would disagree with
   the dial directly above it for anyone not sitting in New York. */

/** "13:30". The time alone — the day is carried once, by its heading. */
export function timeET(at) {
  return new Date(at).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: ET,
  });
}

/* Which ET calendar day an instant falls on, as a sortable string.
   en-CA gives 2026-08-12 rather than 8/12/2026, so it compares as text and
   never has to be parsed back. */
export function dayKey(at) {
  return new Date(at).toLocaleDateString("en-CA", { timeZone: ET });
}

/** The parts of a date heading: WED · 12 · AUG. */
export function dayParts(at) {
  const d = new Date(at);
  const f = (opt) => d.toLocaleDateString("en-US", { timeZone: ET, ...opt });
  return {
    weekday: f({ weekday: "short" }).toUpperCase(),
    date: f({ day: "numeric" }),
    month: f({ month: "short" }).toUpperCase(),
  };
}

/* TODAY / TOMORROW, or nothing.
 *
 * Computed by comparing ET day keys rather than by subtracting 24 hours: a
 * device in Tokyo is already on tomorrow's date while New York is mid-session,
 * and "TODAY" has to mean the trading day the rest of this tab is showing. */
export function dayRelation(at, now = Date.now()) {
  const k = dayKey(at);
  if (k === dayKey(now)) return "today";
  if (k === dayKey(now + 86400000)) return "tomorrow";
  return null;
}

/* How long until it, or how long since. Short forms, and the sign is carried by
   the caller's styling rather than a minus sign nobody reads.
 *
 * PRECISION WHERE IT IS USEFUL AND NOWHERE ELSE. Minutes matter when the
 * release is this session; sixteen hours out they are noise, and they are also
 * too wide — "in 15h 59m" wrapped to a second line and pushed itself out of a
 * fixed-height row. Under six hours it counts in minutes, under two days in
 * hours, and past that in days. */
export function until(at, now = Date.now()) {
  const s = Math.round(Math.abs(at - now) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 6) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/**
 * What is left of the trading week.
 *
 * This used to be a fixed ten-row window that deliberately kept the last two
 * results, and by Thursday that meant a card whose top half had already
 * happened — a history lesson sitting where the week ahead should be. It is a
 * countdown now, and it drains: an event leaves an hour after it fires (see
 * DONE_HOLD_MS), and when the week has run out there is nothing left to show,
 * which is the correct answer and not an error.
 *
 * NO ROW CAP. The card's height is the week's length now, so capping it would
 * put the cap in charge of the size instead of the events.
 *
 * The week bound is what gates the rollover. The feed's file turns over at
 * Sunday midnight, but weekOpenAt does not move until Sunday 6 PM ET, so the
 * coming week's events sit in memory unshown for those eighteen hours and
 * appear the moment the market opens.
 */
export function weekAhead(events, now = Date.now(), hold = DONE_HOLD_MS) {
  const open = weekOpenAt(now);
  const close = open + WEEK_MS;
  return events.filter((e) => e.at >= open && e.at < close && e.at > now - hold);
}

/**
 * The same list, cut into days.
 *
 *   [{ key: "2026-08-12", at, parts: {weekday,date,month}, events: [...] }]
 *
 * Grouping is what lets a row carry a bare time. A date repeated down the left
 * of eight rows is seven repetitions of something you already knew; said once,
 * as a heading, it is the structure of the week.
 */
export function groupByDay(events) {
  const out = [];
  events.forEach((e) => {
    const key = dayKey(e.at);
    const last = out[out.length - 1];
    if (last && last.key === key) last.events.push(e);
    else out.push({ key, at: e.at, parts: dayParts(e.at), events: [e] });
  });
  return out;
}

/**
 * Poll the calendar. Same contract as the wire's createWire, deliberately —
 * this replaced that, and the card, the statuses and the give-up behaviour did
 * not need reinventing to change what is being fetched.
 */
export function createCalendar({
  url = CAL_URL,
  nextUrl = CAL_URL_NEXT,
  every = CAL_POLL_MS,
  onEvents,
  onStatus = () => {},
  fetcher = (u, o) => fetch(u, o),
  giveUpAfter = CAL_CONFIGURED ? 0 : CAL_GIVE_UP,
} = {}) {
  let timer = 0;
  let shut = false;
  let etag = null;
  let fails = 0;
  /* The week after, if the build shipped one. Kept between ticks so a file
     that is simply absent is not re-parsed into an empty array every minute. */
  let ahead = [];

  /* NEVER THROWS, NEVER REPORTS. This file is a hedge against the feed rolling
     over late; the card's health is the primary file's business alone, and a
     missing hedge must not colour the dot red or trip the backoff. */
  const fetchAhead = async () => {
    if (!nextUrl) return [];
    try {
      const res = await fetcher(nextUrl, { cache: "no-store" });
      if (!res.ok) return ahead;
      return parseCalendar(await res.json());
    } catch (e) {
      return ahead;
    }
  };

  /* One pool, sorted, with the id doing the deduplication. The two files
     overlap by design — the id is time plus title, so an event that appears in
     both is the same event and collapses to one row. */
  const merge = (a, b) => {
    const seen = new Map();
    [...a, ...b].forEach((e) => { if (!seen.has(e.id)) seen.set(e.id, e); });
    return [...seen.values()].sort((x, y) => x.at - y.at);
  };
  /* See the wire this replaced: If-None-Match is not CORS-safelisted, so it
     provokes a preflight that a plain static host will not answer. It gets one
     chance to be the culprit before the normal failure path takes over. */
  let conditional = true;

  const tick = async () => {
    if (shut) return;
    const started = Date.now();          // stamped at the START, not the finish
    let sent = null;
    try {
      sent = conditional && etag ? etag : null;
      const res = await fetcher(url, {
        headers: sent ? { "If-None-Match": sent } : {},
        cache: "no-store",
      });
      if (res.status === 304) {
        fails = 0;
        onStatus({ state: "live", at: Date.now() });
      } else if (res.ok) {
        const tag = res.headers.get("ETag");
        if (tag) etag = tag;
        const events = parseCalendar(await res.json());
        fails = 0;
        onStatus({ state: "live", at: Date.now() });
        /* Awaited, so the card is handed one complete pool rather than
           rendering the week and then jumping as the hedge lands. */
        ahead = await fetchAhead();
        if (shut) return;
        onEvents(merge(events, ahead));
      } else if (res.status === 429) {
        const secs = parseInt(res.headers.get("Retry-After"), 10);
        onStatus({ state: "down", at: Date.now(), error: "rate limited" });
        if (shut) return;
        timer = setTimeout(tick, (Number.isFinite(secs) ? secs : 60) * 1000 + 2000);
        return;
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      if (sent) {
        conditional = false;
        etag = null;
        if (shut) return;
        timer = setTimeout(tick, 0);
        return;
      }
      fails += 1;
      onStatus({ state: "down", at: Date.now(), error: String(e.message || e) });
      if (giveUpAfter && fails >= giveUpAfter) { shut = true; return; }
    }
    if (shut) return;
    const wait = fails ? Math.min(every * 2 ** Math.min(fails, 2), 300000) : every;
    timer = setTimeout(tick, Math.max(1000, started + wait - Date.now()));
  };

  onStatus({ state: "loading", at: 0 });
  tick();
  return {
    close() { shut = true; if (timer) clearTimeout(timer); },
    refresh() { if (timer) clearTimeout(timer); fails = 0; tick(); },
  };
}
