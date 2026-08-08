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
 *   IT KEEPS ITS OWN HISTORY. The card does not mirror the feed. It holds the
 *   last ten headlines IT HAS SEEN, and an item stays until ten newer ones have
 *   pushed it off the bottom — not until Financial Juice stops returning it.
 *   Those are different things: the wire is a moving window over roughly the
 *   last hundred items, so a quiet spell followed by a burst can drop something
 *   you were half way through reading. Accumulating locally means the only
 *   thing that removes a headline is another headline.
 *
 *   ONLY WHAT IS NEW MOVES. A list that re-animates on every poll is a list
 *   nobody can read. Items are keyed by the feed's own guid, and the entrance
 *   animation is put on the ids that were not in the history — so a poll that
 *   brings nothing new is visually silent, which is most polls.
 * ------------------------------------------------------------------------- */

/* Ten rows at 50px is 500px of card, which is most of a phone screen — a
   deliberate trade for being able to look away and still find what you missed.
   Keep in step with the min-height on .sess-news-list, or the card will resize
   as it fills and drag the signature with it. */
const SHOW = 10;

export default function News({ active, sessionName, sessionStart }) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState({ state: "loading", at: 0 });
  const [, setClock] = useState(0);
  /* THE HISTORY, and the reason this is a ref rather than state: it has to
     survive the wire being closed and reopened. Leaving the tab shuts the
     socket to save battery, and coming back must not start the list again from
     whatever the feed happens to hold at that moment.
     Sessions is never unmounted, so this lives for the life of the app. */
  const history = useRef([]);
  /* Whether the first poll has landed. Everything in it is "new" by definition
     and none of it should animate — the card would open with ten things flying
     in at once. */
  const seeded = useRef(false);
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
          /* MERGE, do not replace. The feed's answer is a snapshot; the card's
             list is a record. Anything already held stays held, and only items
             the history has never seen are added. */
          const known = new Set(history.current.map((i) => i.id));
          const arrivals = list.filter((i) => !known.has(i.id));

          fresh.current = seeded.current ? new Set(arrivals.map((i) => i.id)) : new Set();
          seeded.current = true;

          /* Sorted by publication time, not by arrival. A wire can deliver an
             item late, and slotting it at the top because that is when we heard
             about it would put an older headline above a newer one — which
             reads as the wire running backwards, the same fault parseFeed
             already guards against. */
          history.current = [...arrivals, ...history.current]
            .sort((a, b) => (b.at || 0) - (a.at || 0))
            .slice(0, SHOW);
          setItems(history.current);
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
  /* Already capped at SHOW when the history is built, so no second slice. */
  const shown = items;
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
            className={`sess-news-item${fresh.current.has(it.id) ? " is-new" : ""}`
              + (it.breaking ? " is-breaking" : "")}
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
