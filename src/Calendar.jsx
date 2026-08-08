import { useEffect, useRef, useState } from "react";
import { createCalendar, stampET, until, windowOf, surprise } from "./calendar";

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

  /* THE CARD IS ALWAYS HERE. No gate at all any more.
   *
   * It has had two: `events.length === 0` first, which could not tell "nothing
   * happened this week" from "nothing has loaded yet" and so hid the card on a
   * genuinely quiet week; then `!loaded`, which fixed that but still meant the
   * card could be missing from the tab entirely while a source was
   * unreachable. Both were attempts to be tactful, and both produced the same
   * confusion: a slot in the layout that is sometimes there and sometimes not.
   *
   * A card that is always present has one state to understand instead of
   * three. It says which week it is showing, or that the week is empty, or
   * that it cannot reach the source and why. All three are useful; none of
   * them is silence. `loaded` stays because the empty message must still not
   * be shown before the first answer — "no events this week" is a claim, and
   * we do not have grounds for it until something has replied. */

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
        {shown.map((e, i) => {
          const done = e.at <= now;
          const isNext = e.id === nextId;
          /* IMMINENT is its own state, not a smaller version of "next". Inside
             the last five minutes the thing you are watching for stops being a
             row in a list and becomes an event, and the card should say so
             before it happens rather than after. */
          const soon = isNext && e.at - now <= 5 * 60 * 1000;
          const beat = done ? surprise(e.actual, e.forecast) : null;
          return (
            <li
              key={e.id}
              className={`sess-cal-row${done ? " is-done" : ""}${isNext ? " is-next" : ""}`
                + (soon ? " is-soon" : "")
                + (beat === 1 ? " is-above" : beat === -1 ? " is-below" : "")}
              /* The stagger index, for the entrance. Capped so a full card does
                 not take a second and a half to finish arriving. */
              style={{ "--i": Math.min(i, 9) }}
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
                  ? <>
                      <b>
                        {/* Which way it missed. Above and below — the reader
                            decides whether that is good, because a hot CPI and
                            hot payrolls point opposite ways. */}
                        {beat === 1 ? "\u25B2 " : beat === -1 ? "\u25BC " : ""}
                        {e.actual}
                      </b>
                      {e.forecast ? <i>vs {e.forecast}</i> : null}
                    </>
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
