import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  createCalendar, timeET, until, surprise,
  weekAhead, groupByDay, dayRelation, weekCloseAt,
} from "./calendar";

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
 * ── IT DRAINS ──────────────────────────────────────────────────────────────
 *
 * It used to hold ten rows open and keep the last two results in them, so by
 * Thursday the top of the card was Monday's news. It is a countdown now. An
 * event leaves an hour after it fires — long enough to catch the print, which
 * with a build-time feed can be a quarter of an hour behind the release, and
 * short enough that the list is visibly emptying. When the week runs out the
 * card shrinks to a single line counting down to the next open, rather than
 * holding five hundred pixels of nothing.
 *
 * THE DATE IS SAID ONCE, BY A HEADING. A stamp on every row repeats the day
 * seven times for seven rows; a heading says it once and gives the rows back
 * their width. TODAY and TOMORROW are named rather than dated, because that is
 * how anyone reads a week they are standing in.
 *
 * THE NEXT EVENT IS THE ONLY ONE THAT IS STYLED. Ten rows all shouting is ten
 * rows of noise; one row lit, with a live countdown, is the thing you actually
 * came to the screen for.
 * ------------------------------------------------------------------------- */

/* Placeholder rows held open during the very first load, so the card arrives
   at roughly its real size instead of unfolding from a sliver and shoving the
   signature down the page. Three, not ten: it is a hint at a shape, and
   guessing high would reintroduce the empty box this change removes. */
const SKELETON = 3;

export default function Calendar({ active }) {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState({ state: "loading", at: 0 });
  const [, setClock] = useState(0);
  /* Whether the source has ever answered successfully — which is NOT the same
     question as whether there are any events, and conflating the two is what
     made "No high-impact US events this week" unreachable in the shipped
     configuration. */
  const [loaded, setLoaded] = useState(false);
  const boxRef = useRef(null);
  const inkRef = useRef(null);

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
        onEvents: (list) => { setEvents(list); setLoaded(true); },
      });
    };
    const shut = () => { if (cal) { cal.close(); cal = null; } };

    open();
    /* The countdown on the next event has to keep being true without the feed
       delivering anything, and it is also what retires a row an hour after it
       fires. One cheap re-render a second, and only of this card — Sessions is
       a sibling, so the dial is untouched. */
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

  const now = Date.now();
  const down = status.state === "down";
  const shown = weekAhead(events, now);
  const days = groupByDay(shown);
  const nextId = (shown.find((e) => e.at > now) || {}).id;
  const opensIn = until(weekCloseAt(now), now);
  /* The same window with no hold at all, which is the only way to tell a week
     that has RUN OUT from one that never had anything in it. Both render as an
     empty list and they are not the same fact — "that's the week" on a Monday
     with nothing scheduled would be a lie about a week that has not happened
     yet. */
  const hadAny = weekAhead(events, now, Infinity).length > 0;

  /* ── THE HEIGHT FOLLOWS THE WEEK ────────────────────────────────────────
   *
   * The list is content-sized now, which is the point — but a list that is
   * content-sized in CSS SNAPS when a row retires, and a card that changes
   * height under your eyes is the layout jump this app has removed twice
   * already. So the height is measured and written, and the write is what the
   * transition runs on. Content decides the number; this only decides how long
   * it takes to get there.
   *
   * It runs on every render because a row can leave on a clock tick with no
   * data change at all — an event that ages past the hold is not an update
   * from the feed, it is simply a second passing.
   *
   * MEASURED FROM AN INNER ELEMENT, and that is not a wrapper for its own
   * sake. Reading scrollHeight off the box whose height is being written back
   * gives a number that can only ever go UP: scrollHeight reports the padding
   * box when the content is shorter than it, so once the card had been tall it
   * could never shrink again — the drained week stayed stuck at whatever the
   * loading skeleton had reserved. The inner list is never given a height, so
   * its offsetHeight is the content and nothing else. */
  const settled = useRef(false);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const ink = inkRef.current;
    if (!box || !ink) return;
    const h = ink.offsetHeight;
    if (!settled.current) {
      /* The first measurement is written without a transition. Animating from
         zero on arrival would make the card unfold on every tab switch. */
      box.style.transition = "none";
      box.style.height = `${h}px`;
      // Read back, forcing the style to land before the transition is restored.
      void box.offsetHeight;
      box.style.transition = "";
      settled.current = true;
      return;
    }
    box.style.height = `${h}px`;
  });

  const rows = (list) => list.map((e) => {
    const done = e.at <= now;
    const isNext = e.id === nextId;
    /* IMMINENT is its own state, not a smaller version of "next". Inside the
       last five minutes the thing you are watching for stops being a row in a
       list and becomes an event, and the card should say so before it happens
       rather than after. */
    const soon = isNext && e.at - now <= 5 * 60 * 1000;
    const beat = done ? surprise(e.actual, e.forecast) : null;
    return (
      <li
        key={e.id}
        className={`sess-cal-row${done ? " is-done" : ""}${isNext ? " is-next" : ""}`
          + (soon ? " is-soon" : "")
          + (beat === 1 ? " is-above" : beat === -1 ? " is-below" : "")}
      >
        <span className="sess-cal-when">
          {timeET(e.at)}
          {/* The countdown replaces nothing and is added only to the next one.
              On every row it would be ten numbers changing every second, which
              is a card nobody can read. A row that has already fired says so
              in words instead, because "in -4m" is not a countdown. */}
          {isNext && <b>in {until(e.at, now)}</b>}
          {done && <b className="out">just in</b>}
        </span>
        <span className="sess-cal-title">{e.title}</span>
        <span className="sess-cal-vals">
          {/* Before: what it is expected to be. After: what it was, with the
              expectation beside it, because a number only means something
              against what was priced in. */}
          {done && e.actual
            ? <>
                <b>
                  {/* Which way it missed. Above and below — the reader decides
                      whether that is good, because a hot CPI and hot payrolls
                      point opposite ways. */}
                  {beat === 1 ? "▲ " : beat === -1 ? "▼ " : ""}
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
  });

  return (
    <div className="sess-cal glass">
      <div className="sess-cal-top">
        <span className={`sess-cal-dot${down ? " down" : status.state === "live" ? " on" : ""}`} aria-hidden="true" />
        <span className="sess-cal-label">{down ? "Calendar down" : "Week ahead"}</span>
        <i aria-hidden="true" />
        <span className="sess-cal-src">US · High impact</span>
      </div>

      <div className="sess-cal-list" ref={boxRef}>
      <ul className="sess-cal-rows" ref={inkRef}>
        {/* Nothing has answered yet: hold a plausible shape rather than a
            spinner, which is the same trick the price card uses. */}
        {!loaded && !down && Array.from({ length: SKELETON }, (_, i) => (
          <li className="sess-cal-row is-skeleton" key={`s${i}`} style={{ "--i": i }} aria-hidden="true">
            <span className="sess-cal-when"><em /></span>
            <span className="sess-cal-title"><em /></span>
            <span className="sess-cal-vals"><em /></span>
          </li>
        ))}

        {/* THE WEEK IS DONE, OR NEVER HAD ANYTHING IN IT. One line, not an
            empty box — and a live countdown to Sunday 6 PM ET rather than a
            full stop, because "nothing left" and "here is when there will be"
            are the same fact and the second one is the useful half. */}
        {(loaded || down) && days.length === 0 && (
          <li className="sess-cal-row sess-cal-rest">
            <span className="sess-cal-title">
              {down
                ? `Cannot reach the calendar${status.error ? ` — ${status.error}` : ""}`
                : hadAny
                  ? "That's the week — nothing high-impact left"
                  : "No high-impact US events this week"}
            </span>
            {!down && (
              <span className="sess-cal-opens">
                Next week opens SUN 6:00 PM ET
                <b>in {opensIn}</b>
              </span>
            )}
          </li>
        )}

        {days.map((d, gi) => {
          const rel = dayRelation(d.at, now);
          /* The month is printed on the first heading and again only when it
             changes. A week that does not cross a month says AUG once, which
             is once more than a row-by-row stamp ever managed and far less
             than saying it every day. */
          const showMonth = gi === 0 || d.parts.month !== days[gi - 1].parts.month;
          return (
            <li className="sess-cal-group" key={d.key} style={{ "--i": Math.min(gi * 2, 9) }}>
              <div className={`sess-cal-day${rel ? ` is-${rel}` : ""}`}>
                <span className="sess-cal-dnum">{d.parts.date}</span>
                <span className="sess-cal-dstack">
                  <b>{d.parts.weekday}</b>
                  {showMonth && <em>{d.parts.month}</em>}
                </span>
                {rel && <span className="sess-cal-dtag">{rel}</span>}
                <i aria-hidden="true" />
                <span className="sess-cal-dcount">
                  {d.events.length}
                  <em>{d.events.length === 1 ? "event" : "events"}</em>
                </span>
              </div>
              <ul className="sess-cal-day-rows">{rows(d.events)}</ul>
            </li>
          );
        })}
      </ul>
      </div>
    </div>
  );
}
