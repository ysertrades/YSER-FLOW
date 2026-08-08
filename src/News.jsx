import { useEffect, useRef, useState } from "react";
import { createWire, ago, NEWS_URL } from "./news";

/* ---------------------------------------------------------------------------
 * The wire, under the price.
 *
 * Three cards now say one sentence: the dial is WHEN, the price card is WHAT,
 * this is WHY. Each is narrower in time than the one above it.
 *
 * Financial Juice is a high-volume wire — headlines land in bursts, several a
 * minute when something is happening. Two consequences drive everything here:
 *
 *   IT SHOWS FIVE, NOT FIFTY. A card that grows with the news pushes the
 *   signature off the page and turns a glance into a scroll. Five is what fits
 *   under the price card without the tab needing a second screen, and the wire
 *   keeps forty so "new since you looked" stays answerable.
 *
 *   ONLY WHAT IS NEW MOVES. A list that re-animates on every poll is a list
 *   nobody can read. Items are keyed by the feed's own guid, and the entrance
 *   animation is put on the ids that were not there last time — so a poll that
 *   brings nothing new is visually silent, which is most polls.
 * ------------------------------------------------------------------------- */

const SHOW = 5;

export default function News({ active, sessionName, sessionStart }) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState({ state: "loading", at: 0 });
  const [, setClock] = useState(0);
  /* Ids present at the previous render, so "new" is a fact rather than a guess
     from timestamps — a wire can republish an item with a fresher date. */
  const seen = useRef(null);
  const fresh = useRef(new Set());
  const freshTimer = useRef(0);

  useEffect(() => {
    if (!active || !NEWS_URL) return undefined;
    let wire = null;
    const open = () => {
      if (wire || document.hidden) return;
      wire = createWire({
        onStatus: setStatus,
        onItems: (list) => {
          const ids = new Set(list.map((i) => i.id));
          /* First load is not "new". Everything would be, and the card would
             open with five things flying in at once. */
          fresh.current = seen.current
            ? new Set([...ids].filter((id) => !seen.current.has(id)))
            : new Set();
          seen.current = ids;
          setItems(list);
          /* And then stop being new. Without this the marking is permanent:
             onItems is the only place it is recomputed, and a poll that returns
             304 never gets there — so an item stayed flagged as an arrival for
             as long as it was on screen, and would replay its entrance on any
             later re-render. New is an event, not a property. */
          clearTimeout(freshTimer.current);
          freshTimer.current = setTimeout(() => {
            fresh.current = new Set();
            setClock((c) => c + 1);
          }, 700);
        },
      });
    };
    const shut = () => { if (wire) { wire.close(); wire = null; } };

    open();
    /* The stamps say "40s" and have to keep being true without the wire
       delivering anything. One cheap re-render a second, and only of this
       card — Sessions is a sibling, so the dial is untouched. */
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

  /* No wire configured, no card. See NEWS_URL in news.js — an absent card beats
     one showing headlines that are not real. */
  if (!NEWS_URL) return null;

  const now = Date.now();
  const shown = items.slice(0, SHOW);
  const down = status.state === "down";

  /* A headline that landed inside the window you are trading gets a mark. This
     is the whole session tie-in and it is deliberately this small: the feed is
     headlines, not a calendar, so it cannot tell you what is COMING — only
     which of these arrived while the window was open. Claiming more than that
     would be inventing data. */
  const inSession = (at) => sessionStart != null && at != null && at >= sessionStart;

  return (
    <div className="sess-news glass">
      <div className="sess-news-top">
        <span className={`sess-news-dot${down ? " down" : status.state === "live" ? " on" : ""}`} aria-hidden="true" />
        <span className="sess-news-label">{down ? "Wire down" : "Newswire"}</span>
        <i aria-hidden="true" />
        <span className="sess-news-src">Financial Juice</span>
      </div>

      <ul className="sess-news-list">
        {shown.length === 0 && (
          /* A row of the right height, not a spinner and not nothing. The card
             must be the same size empty as full or the signature moves under
             it as the first poll lands. */
          <li className="sess-news-item sess-news-empty">
            <span className="sess-news-when">—</span>
            <span className="sess-news-text">
              {down ? "Cannot reach the wire" : "Waiting for the wire"}
            </span>
          </li>
        )}
        {shown.map((it) => (
          <li
            key={it.id}
            className={`sess-news-item${fresh.current.has(it.id) ? " is-new" : ""}`}
          >
            <span className="sess-news-when">{ago(it.at, now)}</span>
            {it.link ? (
              <a className="sess-news-text" href={it.link} target="_blank" rel="noopener noreferrer">
                {it.title}
              </a>
            ) : (
              <span className="sess-news-text">{it.title}</span>
            )}
            {inSession(it.at) && (
              <span className="sess-news-flag" title={`Landed during ${sessionName}`} aria-hidden="true" />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
