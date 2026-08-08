import { useEffect, useRef, useState } from "react";
import { PAIRS, STALE_MS, createFeed, foldRange, rangePos } from "./feed";

/* ---------------------------------------------------------------------------
 * The price card, under the Today table.
 *
 * It shows a range, not a ticker. A last price with a green arrow is the strip
 * every trading app has and it would ignore the screen it is sitting on; the
 * high and low built since the current killzone OPENED is the thing the rest of
 * this tab is about. Outside a window it falls back to the day's range, so the
 * card never empties and never has to explain itself.
 *
 * TWO RATES, ON PURPOSE. Quotes arrive as fast as the exchange trades — BTC can
 * be tens of messages a second — and every one of them updates the range, which
 * is cheap and must not be missed. Only the DRAWING is throttled, to 4Hz. The
 * high never comes from a sampled tick, and the screen never renders faster
 * than an eye can read a five-digit number.
 * ------------------------------------------------------------------------- */

const DRAW_MS = 250;

const money = (v, dp) => v == null ? "—"
  : v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export default function Feed({ active, periodId, periodLabel, sources }) {
  const [pair, setPair] = useState("btc");
  /* One state object, replaced wholesale on a timer. Individually setState-ing
     price, range and status would be three renders where one will do. */
  const [view, setView] = useState({ state: "connecting", source: null, at: 0, q: {}, r: {} });

  const box = useRef({ state: "connecting", source: null, at: 0, q: {}, r: {} });
  const period = useRef(periodId);
  period.current = periodId;

  useEffect(() => {
    if (!active) return undefined;

    let feed = null;
    let draw = 0;

    const open = () => {
      if (feed || document.hidden) return;
      feed = createFeed({
        sources,
        onStatus: ({ state, source }) => { box.current.state = state; box.current.source = source; },
        onQuote: ({ key, price, changePct }) => {
          const b = box.current;
          const at = Date.now();
          b.at = at;
          b.q[key] = { price, changePct };
          /* foldRange is keyed on the period, so it resets itself the moment a
             killzone opens or closes. Nothing here has to watch for that. */
          b.r[key] = foldRange(b.r[key], { id: period.current, price, at });
        },
      });
    };
    const shut = () => { if (feed) { feed.close(); feed = null; } };

    open();
    /* The same redraw that shows a new price is what notices there has not been
       one. Staleness is time since the last tick, checked on the draw timer, so
       it costs nothing extra and can never disagree with what is on screen. */
    draw = setInterval(() => setView({ ...box.current, q: { ...box.current.q }, r: { ...box.current.r } }), DRAW_MS);

    /* A socket held open behind another tab is a battery bug. Same three events
       the particle field listens to, and for the same reason: browsers do not
       agree on which one fires when you come back. */
    const onVis = () => { if (document.hidden) shut(); else open(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", open);
    window.addEventListener("focus", open);
    return () => {
      clearInterval(draw);
      shut();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", open);
      window.removeEventListener("focus", open);
    };
  }, [active, sources]);

  const meta = PAIRS.find((p) => p.key === pair) || PAIRS[0];
  const q = view.q[pair] || null;
  const r = view.r[pair] || null;
  const stale = view.at > 0 && Date.now() - view.at > STALE_MS;
  const live = view.state === "live" && !stale && q;
  const pos = r && q ? rangePos(r.lo, r.hi, q.price) : 0.5;
  const up = q && q.changePct != null && q.changePct >= 0;

  /* What the range actually covers, said plainly. The feed only sees prices
     from the moment it connects, so on a window that opened before you did, the
     honest label is the time it really starts from — not the session's open,
     which would be a claim about data the card does not have. */
  const from = r ? new Date(r.from) : null;
  const fromLabel = from
    ? from.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
    : null;

  return (
    <div className="sess-feed glass">
      <div className="sess-feed-top">
        <span className={`sess-feed-dot${live ? " on" : ""}${stale ? " stale" : ""}`} aria-hidden="true" />
        <span className="sess-feed-state">
          {stale ? "Stale" : view.state === "live" ? (view.source || "Live")
            : view.state === "down" ? "Reconnecting" : "Connecting"}
        </span>
        <i aria-hidden="true" />
        <div className="sess-feed-chips" role="group" aria-label="Instrument">
          {PAIRS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`sess-feed-chip${p.key === pair ? " on" : ""}`}
              aria-pressed={p.key === pair}
              onClick={() => setPair(p.key)}
            >{p.label}</button>
          ))}
        </div>
      </div>

      <div className="sess-feed-price">
        <b className={stale ? "dim" : undefined}>{q ? money(q.price, meta.dp) : "—"}</b>
        <span className={`sess-feed-chg${q && q.changePct != null ? (up ? " up" : " down") : ""}`}>
          {q && q.changePct != null
            ? `${up ? "+" : "−"}${Math.abs(q.changePct).toFixed(2)}%`
            : "—"}
        </span>
      </div>

      {/* The bar is always in the DOM at a real height. Showing it only once
          there is data would change the card's height on the first tick, and
          the Today card directly above would jump. */}
      <div className="sess-feed-bar" aria-hidden="true">
        <i />
        <span className="sess-feed-mark" style={{ left: `${(pos * 100).toFixed(2)}%` }} />
      </div>
      <div className="sess-feed-foot">
        <span>{r ? money(r.lo, meta.dp) : "—"}</span>
        <em>
          {periodLabel}
          {fromLabel ? ` · range since ${fromLabel}` : " · waiting for a price"}
        </em>
        <span>{r ? money(r.hi, meta.dp) : "—"}</span>
      </div>
    </div>
  );
}
