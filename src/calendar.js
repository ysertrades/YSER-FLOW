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

const DIRECT = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

/* Same arrangement as the wire it replaces: optional override in index.html,
 *
 *     <meta name="cal-feed" content="https://yser-cal.<you>.workers.dev">
 *
 * and when it is absent the app asks the source directly. If faireconomy sends
 * Access-Control-Allow-Origin it simply works with no Worker at all; if it does
 * not, the card stays invisible rather than announcing a failure to someone who
 * never asked for a calendar. Configured means deliberate, and a configured
 * feed shows its failures. */
const META = (typeof document !== "undefined"
  && document.querySelector('meta[name="cal-feed"]')?.content) || "";

export const CAL_URL = META || DIRECT;
export const CAL_CONFIGURED = Boolean(META);
export const CAL_GIVE_UP = 3;

/* A WEEK OF EVENTS DOES NOT CHANGE EVERY TWENTY SECONDS. The schedule is fixed
   days ahead; the only thing that moves is `actual`, which appears the moment a
   number is released. Sixty seconds is quick enough that a print shows up while
   you are still looking at the screen, and slow enough to be invisible to
   whoever is paying for the bandwidth. */
export const CAL_POLL_MS = (typeof document !== "undefined"
  && Number(document.querySelector('meta[name="cal-poll"]')?.content)) || 60000;

const ET = "America/New_York";
const str = (v) => (typeof v === "string" ? v.trim() : "");

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

/* "MON 8:30", in ET, because every other clock on this tab is ET and a
   calendar that quietly used the device's timezone would disagree with the dial
   directly above it for anyone not sitting in New York. */
export function stampET(at) {
  const d = new Date(at);
  const day = d.toLocaleDateString("en-US", { weekday: "short", timeZone: ET }).toUpperCase();
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: false, timeZone: ET,
  });
  return `${day} ${time}`;
}

/* How long until it, or how long since. Short forms, and the sign is carried by
   the caller's styling rather than a minus sign nobody reads. */
export function until(at, now = Date.now()) {
  const s = Math.round(Math.abs(at - now) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/**
 * The ten rows worth showing, out of a week.
 *
 * NOT simply the first ten. A week can hold more than ten high-impact US
 * prints, and by Thursday the first ten are all in the past — a calendar whose
 * visible half has already happened is a history lesson. The window starts two
 * before the next event, so you keep the last couple of results (with their
 * actuals, which is when they are most useful) and everything ahead of them.
 */
export function windowOf(events, now = Date.now(), size = 10) {
  if (events.length <= size) return events;
  const next = events.findIndex((e) => e.at > now);
  if (next === -1) return events.slice(-size);          // the week is over
  const start = Math.min(Math.max(0, next - 2), events.length - size);
  return events.slice(start, start + size);
}

/**
 * Poll the calendar. Same contract as the wire's createWire, deliberately —
 * this replaced that, and the card, the statuses and the give-up behaviour did
 * not need reinventing to change what is being fetched.
 */
export function createCalendar({
  url = CAL_URL,
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
        onEvents(events);
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
