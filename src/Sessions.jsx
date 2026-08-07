import { useRef } from "react";
import { useEtTick, readDay, MARKS } from "./sessions";

/* ---------------------------------------------------------------------------
 * Sessions — the trading day as a 24-hour dial.
 *
 * Why a ring and not a bar: a day laid flat across a phone gives roughly 16px
 * an hour, and every window collapses into a sliver you cannot label. On a ring
 * each window gets a real arc, and "how long until the next one" becomes a
 * distance you can see rather than a number you have to read. Midnight at the
 * top, noon at the bottom, clockwise.
 *
 * Two rings, because the silver bullet sits ENTIRELY INSIDE the NY killzone.
 * On one ring the shorter arc would simply be painted over the longer one.
 * Outer is the sessions, inner is the window within a session.
 *
 * The colour is deliberately not a per-session palette. Arcs are neutral;
 * green means open right now and blue means up next — exactly the two meanings
 * those colours already carry in the calculator, so nothing has to be relearned
 * moving between tabs.
 * ------------------------------------------------------------------------- */

const CX = 150, CY = 150, R_OUT = 104, R_IN = 85;
const OPEN = "#4ADE80";
const NEXT = "#0a84ff";

const fmtTime = (m) => {
  m = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  const ap = h < 12 ? "AM" : "PM";
  let hh = h % 12; if (hh === 0) hh = 12;
  return `${hh}:${String(mm).padStart(2, "0")} ${ap}`;
};
const dur = (m) => {
  if (m >= 1440) return `${Math.round(m / 1440)}d`;
  const h = Math.floor(m / 60), mm = Math.round(m % 60);
  return h ? `${h}h ${mm}m` : `${mm}m`;
};
const ptAt = (m, r) => {
  const a = (m / 1440) * 2 * Math.PI - Math.PI / 2;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
};

/* An arc as a dash on a circle rather than a hand-built path: the visible dash
   is the window's share of the day, and the offset is where it starts. One line
   of maths instead of an arc-flag puzzle. */
function Arc({ r, start, end, stroke, width, glow }) {
  const C = 2 * Math.PI * r;
  const len = ((end - start) / 1440) * C;
  return (
    <circle
      cx={CX} cy={CY} r={r} fill="none"
      stroke={stroke} strokeWidth={width} strokeLinecap="round"
      strokeDasharray={`${len} ${C - len}`}
      strokeDashoffset={-((start / 1440) * C)}
      transform={`rotate(-90 ${CX} ${CY})`}
      filter={glow ? "url(#sessGlow)" : undefined}
    />
  );
}

function colourFor(w, nextKey, ahead, done) {
  if (w.state === "open") return OPEN;
  if (w.key === nextKey) return NEXT;
  return w.state === "ahead" ? ahead : done;
}

function Row({ w, nextKey, closed, sub }) {
  const isOpen = w.state === "open";
  const isNext = w.key === nextKey;
  const cls = isOpen ? "open" : isNext ? "next" : w.state === "done" ? "done" : "";
  const bul = isOpen ? "on" : isNext ? "next" : w.state === "done" ? "done" : "";
  const right = closed ? "—"
    : isOpen ? `${dur(w.remaining)} left`
    : w.state === "done" ? "done" : `in ${dur(w.until)}`;
  return (
    <div className={`sess-row ${cls}${sub ? " sess-sub" : ""}`}>
      {sub && <span className="sess-tee" aria-hidden="true" />}
      <span className={`sess-bul ${bul}`} aria-hidden="true" />
      <span className="sess-nm">{w.name}</span>
      <span className="sess-at">{w.at}</span>
      <span className="sess-st">{right}</span>
    </div>
  );
}

export default function Sessions({ active, now }) {
  useEtTick();                       // re-render on the second boundary
  const d = readDay(now);            // `now` is only ever passed by the tests
  const { closed, ring, sub, upcoming, nextKey, openSub, primary } = d;

  /* It rides the same .pane machinery the editor and guide use, so switching to
     it crossfades exactly like every other tab instead of cutting. That also
     keeps it off the document flow, so the calculator's scroll position is
     untouched while this is up.

     Same rule as StaticPane: a surface that has never been shown must not play
     the leaving animation, or it fades *in* from opacity 1 on its way out. */
  const opened = useRef(false);
  if (active) opened.current = true;
  const paneState = active ? "pane-on" : opened.current ? "pane-off" : "pane-hidden";

  const ampm = d.hours < 12 ? "AM" : "PM";
  let hh = d.hours % 12; if (hh === 0) hh = 12;
  const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.day];

  /* the list: sessions in time order, each followed by any window inside it */
  const listed = [];
  [...ring].sort((a, b) => a.start - b.start).forEach((w) => {
    listed.push({ w, sub: false });
    sub.filter((s) => s.parent === w.name).forEach((s) => listed.push({ w: s, sub: true }));
  });

  return (
    <div className={`pane ${paneState}`} aria-hidden={!active}>
      <div className="sess-scroll">
        <div className="sess-wrap">
      <div className="sess-head">
        <b>{dayName}</b><span>·</span><span>New York</span>
        <i aria-hidden="true" /><span>ET</span>
      </div>

      <div className="sess-dial-wrap">
        <svg className="sess-dial" viewBox="0 0 300 300" role="img"
             aria-label={closed ? "Market closed for the weekend"
               : primary ? `${primary.name}, ${dur(primary.remaining)} remaining`
               : "No session open"}>
          <defs>
            <filter id="sessGlow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* hour ticks, heavier every six */}
          {Array.from({ length: 24 }, (_, h) => {
            const major = h % 6 === 0;
            const a = ptAt(h * 60, R_OUT + 9);
            const b = ptAt(h * 60, R_OUT + (major ? 17 : 13));
            return <line key={h} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
              stroke={major ? "rgba(255,255,255,.30)" : "rgba(255,255,255,.10)"}
              strokeWidth={major ? 1.6 : 1} strokeLinecap="round" />;
          })}

          {[[0, "12a"], [360, "6a"], [720, "12p"], [1080, "6p"]].map(([m, label]) => {
            const p = ptAt(m, R_OUT + 30);
            return <text key={label} x={p[0]} y={p[1]} fill="rgba(255,255,255,.34)"
              fontSize="10.5" fontWeight="700" textAnchor="middle"
              dominantBaseline="central" letterSpacing=".08em"
              style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{label}</text>;
          })}

          {/* the tracks */}
          <Arc r={R_OUT} start={0} end={1440} stroke="rgba(255,255,255,.055)" width={12} />
          <Arc r={R_IN}  start={0} end={1440} stroke="rgba(255,255,255,.04)"  width={7} />

          {ring.map((w) => (
            <Arc key={w.key} r={R_OUT} start={w.start} end={w.end} width={12}
              stroke={colourFor(w, nextKey, "rgba(255,255,255,.22)", "rgba(255,255,255,.08)")}
              glow={w.state === "open" || w.key === nextKey} />
          ))}
          {sub.map((w) => (
            <Arc key={w.key} r={R_IN} start={w.start} end={w.end} width={7}
              stroke={colourFor(w, nextKey, "rgba(255,255,255,.18)", "rgba(255,255,255,.07)")}
              glow={w.state === "open" || w.key === nextKey} />
          ))}

          {/* instants, drawn across both rings */}
          {MARKS.map((mk) => {
            const a = ptAt(mk.minute, R_IN - 7), b = ptAt(mk.minute, R_OUT + 6);
            return <line key={mk.key} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
              stroke="rgba(255,255,255,.13)" strokeWidth={1} strokeDasharray="2 3" />;
          })}

          {/* now — a stub outside the inner ring, not a hand through the middle,
              which would cut straight across the readout */}
          {!closed && (() => {
            const n1 = ptAt(d.totalMinutes, R_IN - 13);
            const n2 = ptAt(d.totalMinutes, R_OUT - 10);
            const dot = ptAt(d.totalMinutes, R_OUT);
            return (
              <g>
                <line x1={n1[0]} y1={n1[1]} x2={n2[0]} y2={n2[1]}
                  stroke="rgba(255,255,255,.45)" strokeWidth={1.4} strokeLinecap="round" />
                <circle cx={dot[0]} cy={dot[1]} r={5.5} fill="#fff" filter="url(#sessGlow)" />
              </g>
            );
          })()}
        </svg>

        <div className="sess-centre">
          {closed ? (
            <>
              <div className="sess-clock sess-shut">CLOSED</div>
              <div className="sess-state" style={{ color: "#ff6961" }}>Weekend</div>
              <div className="sess-left">opens Sun 6:00 PM · {dur(d.reopenIn)}</div>
            </>
          ) : (
            <>
              <div className="sess-clock">
                {hh}:{String(d.minutes).padStart(2, "0")}<small>{ampm}</small>
              </div>
              {primary ? (
                <>
                  <div className="sess-state" style={{ color: OPEN }}>{primary.name}</div>
                  <div className="sess-left">{dur(primary.remaining)} left</div>
                  {openSub && openSub !== primary && (
                    <div className="sess-sublabel">
                      {openSub.name.toLowerCase()} · {dur(openSub.remaining)}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="sess-state sess-none">No window open</div>
                  <div className="sess-left">
                    {upcoming[0] ? `${upcoming[0].name} in ${dur(upcoming[0].until)}` : "—"}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div className="sess-block glass">
        <div className="sess-blabel">Next</div>
        {upcoming.length === 0 ? (
          <div className="sess-row done">
            <span className="sess-bul done" aria-hidden="true" />
            <span className="sess-nm">Nothing left today</span>
          </div>
        ) : upcoming.slice(0, 2).map((w, i) => (
          <div key={w.key} className={`sess-row${i === 0 ? " next" : ""}`}>
            <span className={`sess-bul ${i === 0 ? "next" : ""}`} aria-hidden="true" />
            <span className="sess-nm">{w.name}</span>
            <span className="sess-at">{fmtTime(w.start)}</span>
            <span className="sess-st">in {dur(w.until)}</span>
          </div>
        ))}
      </div>

      <div className="sess-block glass">
        <div className="sess-blabel">Today</div>
        {listed.map(({ w, sub: isSub }) => (
          <Row key={w.key} w={w} nextKey={nextKey} closed={closed} sub={isSub} />
        ))}
          </div>
        </div>
      </div>
    </div>
  );
}
