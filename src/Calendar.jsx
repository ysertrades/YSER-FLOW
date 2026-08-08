import { useEffect, useRef, useState } from "react";
import { createCalendar, stampET, until, windowOf, CAL_CONFIGURED } from "./calendar";

/* ---------------------------------------------------------------------------
 * The week ahead, under the price.
 *
 * This replaced the newswire, and the difference is tense. A wire is past
 * tense — it tells you something moved once it already has. A calendar is
 * future tense, and on a screen built around WHEN, that is the one that
 * belongs: the dial says which window you are in, the price says what it is
 * doing, and this says what is about to hit it.
 *
 * US high impact only, which keeps a week down to something you can take in at
 * a glance. Everything else the feed carries is dropped in calendar.js before
 * it gets here.
 *
 * THE NEXT EVENT IS THE ONLY ONE THAT IS STYLED. Ten rows all shouting is ten
 * rows of noise; one row lit, with a live countdown, is the thing you actually
 * came to the screen for. Past events dim and swap their forecast for what
 * actually printed, which is when that number is worth anything.
 * ------------------------------------------------------------------------- */

const SHOW = 10;

export default function Calendar({ active }) {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState({ state: "loading", at: 0 });
  const [, setClock] = useState(0);
  /* Whether the source has ever answered successfully — which is NOT the same
     question as whether there are any events, and conflating the two is what
     made "No high-impact US events this week" unreachable in the shipped
     configuration. See the render gate below. */
  const [loaded, setLoaded] = useState(false);
  const held = useRef([]);

  useEffect(() => {
    if (!active) return undefined;
    let cal = null;
    const open = () => {
      if (cal || document.hidden) return;
      cal = createCalendar({
        onStatus: setStatus,
        /* Replace rather than merge, unlike the wire. A calendar is a
           statement about the week, not a stream of arrivals — if an event is
           cancelled or rescheduled the feed dropping it is the correct answer,
           and holding on to it would be showing you a release that is not
           happening. */
        onEvents: (list) => { held.current = list; setEvents(list); setLoaded(true); },
      });
    };
    const shut = () => { if (cal) { cal.close(); cal = null; } };

    open();
    /* The countdown on the next event has to keep being true without the feed
       delivering anything. One cheap re-render a second, and only of this card
       — Sessions is a sibling, so the dial is untouched. */
    const t = setInterval(() => setClock((c) => c + 1), 1000);

    const onVis = () => { if (document.hidden) shut(); else open(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", open);
    window.addEventListener("focus", open);
    return () => {
      clearInterval(t);
      shut();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", open);
      window.removeEventListener("focus", open);
    };
  }, [active]);

  /* GATED ON "HAS IT ANSWERED", NOT ON "ARE THERE EVENTS".
   *
   * Those look like the same test and are not, and the difference is a whole
   * state that used to be invisible. A week with no high-impact US prints is a
   * REAL and useful answer — holiday weeks have them — and this used to hide
   * the card for it, because it read `events.length === 0` and could not tell
   * "nothing happened this week" from "nothing has loaded yet". The empty-week
   * message existed and was unreachable in the shipped configuration; only a
   * configured feed could ever show it.
   *
   * Once the source has answered once, the card stays: it either lists the
   * week or says the week is empty. Before that, unconfigured, it stays out of
   * the way — nobody who did not ask for a calendar should be shown one
   * reporting itself broken. */
  if (!CAL_CONFIGURED && !loaded) return null;

  const now = Date.now();
  const down = status.state === "down";
  const shown = windowOf(events, now, SHOW);
  const nextId = (events.find((e) => e.at > now) || {}).id;

  return (
    <div className="sess-cal glass">
      <div className="sess-cal-top">
        <span className={`sess-cal-dot${down ? " down" : status.state === "live" ? " on" : ""}`} aria-hidden="true" />
        <span className="sess-cal-label">{down ? "Calendar down" : "This week"}</span>
        <i aria-hidden="true" />
        <span className="sess-cal-src">US · High impact</span>
      </div>

      <ul className="sess-cal-list">
        {shown.length === 0 && (
          <li className="sess-cal-row sess-cal-empty">
            <span className="sess-cal-when">—</span>
            <span className="sess-cal-title">
              {down
                ? `Cannot reach the calendar${status.error ? ` — ${status.error}` : ""}`
                : status.state === "live"
                  ? "No high-impact US events this week"
                  : "Loading the week"}
            </span>
          </li>
        )}
        {shown.map((e) => {
          const done = e.at <= now;
          const isNext = e.id === nextId;
          return (
            <li
              key={e.id}
              className={`sess-cal-row${done ? " is-done" : ""}${isNext ? " is-next" : ""}`}
            >
              <span className="sess-cal-when">
                {stampET(e.at)}
                {/* The countdown replaces the stamp only on the next one. On
                    every row it would be ten numbers changing every second,
                    which is a card nobody can read. */}
                {isNext && <b>in {until(e.at, now)}</b>}
              </span>
              <span className="sess-cal-title">{e.title}</span>
              <span className="sess-cal-vals">
                {/* Before: what it is expected to be. After: what it was, with
                    the expectation beside it, because a number only means
                    something against what was priced in. */}
                {done && e.actual
                  ? <><b>{e.actual}</b>{e.forecast ? <i>vs {e.forecast}</i> : null}</>
                  : e.forecast
                    ? <i>exp {e.forecast}</i>
                    : e.previous ? <i>prev {e.previous}</i> : <i>—</i>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
