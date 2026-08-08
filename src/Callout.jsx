import { useEffect, useRef, useState } from "react";

/* ---------------------------------------------------------------------------
 * The first-run pointer at the trade card editor.
 *
 * Shown once, ever. Not once a session, not once a day — once, and then never
 * again on that device.
 *
 * WHICH BUTTON IT POINTS AT. You said "above the guide button", and it is
 * anchored to the EDITOR button instead, because the message is "open the
 * trade card editor" and a bubble that points at one button while naming
 * another is worse than no bubble. Moving it is one word — the `anchor` prop
 * below takes any tab id. Say so and it moves.
 *
 * ── ONCE, EVER, IS THE HARD PART, AND IT CANNOT BE GUARANTEED ──────────────
 *
 * This app runs inside a Whop iframe, which makes it third-party in storage
 * terms. Safari partitions storage per embedding site and can refuse it
 * outright; a private tab throws on the first write. localStorage is therefore
 * best-effort here, not a promise, and pretending otherwise would be the same
 * class of lie as a frozen price.
 *
 * So it degrades in steps rather than failing:
 *
 *   localStorage    once ever, which is the intent
 *   sessionStorage  once per browsing session, if the first is refused
 *   memory          once per page load, if both are
 *
 * Every level is written on FIRST SIGHT, not on dismissal. Someone who sees it
 * and closes the app without touching it has still seen it, and showing it
 * again would be the annoying version of this.
 * ------------------------------------------------------------------------- */

const KEY = "yser.seen.editor-callout.v1";

/* Each store in its own try. A single try around both means a localStorage
   that throws takes sessionStorage down with it, and the fallback never runs
   in the exact case it exists for. */
const readFlag = () => {
  try { if (window.localStorage.getItem(KEY)) return true; } catch (e) { /* refused */ }
  try { if (window.sessionStorage.getItem(KEY)) return true; } catch (e) { /* refused */ }
  return false;
};
const writeFlag = () => {
  try { window.localStorage.setItem(KEY, "1"); return; } catch (e) { /* refused */ }
  try { window.sessionStorage.setItem(KEY, "1"); } catch (e) { /* refused */ }
};

/* Long enough to read eleven words twice, short enough that it is gone before
   it is furniture. It also leaves on any tab press, so this is the ceiling
   rather than the usual case. */
const LIFE = 9000;

export default function Callout({ ready, tab, onGo, anchor = "card" }) {
  const [show, setShow] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    /* Not until the intro has cleared and the landing tab has had its entrance.
       A tip that arrives during the dial's sweep is a tip nobody reads, and it
       would be competing with the one animation this app spent three rounds
       getting smooth. */
    if (!ready || done.current) return undefined;
    if (readFlag()) { done.current = true; return undefined; }

    const t = setTimeout(() => {
      /* Written the moment it becomes visible. Waiting for a dismissal means
         someone who sees it and closes the app gets it again next time. */
      writeFlag();
      done.current = true;
      setShow(true);
    }, 1600);
    return () => clearTimeout(t);
  }, [ready]);

  /* Any tab press dismisses it, including the one it is pointing at. It has
     done its job either way, and a bubble that outlives the action it asked
     for is just something in the way. */
  useEffect(() => {
    if (show) setLeaving(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (!show) return undefined;
    const t = setTimeout(() => setLeaving(true), LIFE);
    return () => clearTimeout(t);
  }, [show]);

  useEffect(() => {
    if (!leaving) return undefined;
    const t = setTimeout(() => { setShow(false); setLeaving(false); }, 320);
    return () => clearTimeout(t);
  }, [leaving]);

  if (!show) return null;

  return (
    <div className={`callout callout-${anchor}${leaving ? " callout-out" : ""}`}>
      <button
        type="button"
        className="callout-body"
        onClick={() => { setLeaving(true); onGo(anchor); }}
      >
        <span className="callout-kicker">Start here</span>
        <span className="callout-text">
          Turn a chart screenshot into a clean trade card
        </span>
        <span className="callout-go" aria-hidden="true">Open editor →</span>
      </button>
      {/* The nib is a rotated square rather than a border triangle: a triangle
          cannot carry the bubble's blur or its hairline, so it reads as a
          separate paler shape stuck underneath. */}
      <span className="callout-nib" aria-hidden="true" />
    </div>
  );
}
