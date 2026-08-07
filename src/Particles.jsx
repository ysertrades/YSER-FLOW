import { useEffect, useRef } from "react";

/* ---------------------------------------------------------------------------
 * Drifting particles behind the dial.
 *
 * Adapted from the Framer component, with the Framer parts removed (there is no
 * property-control surface here and no static renderer to guard against) and
 * three things changed for the way this app actually runs it:
 *
 *   1. The canvas is TRANSPARENT. The original painted its own backdrop, which
 *      would put a second opaque ground over the app's — the exact thing that
 *      made the old radial wash visible as a separate layer. The ground is the
 *      page's, flat, and this only adds to it.
 *
 *   2. It stops. The original animates from mount to unmount; this one is
 *      mounted for the life of the app because Sessions is, so an unconditional
 *      rAF loop would be repainting a full-screen canvas the whole time you are
 *      reading the guide. It runs while the tab is up and the document is
 *      visible, and not otherwise.
 *
 *   3. The dots are a SPRITE, not a path per frame. A soft-edged dot wants a
 *      radial gradient, and building one per particle per frame is the
 *      expensive way to do it. One 64px sprite is rasterised once and stamped
 *      with drawImage, which is a blit — so the softness is free.
 *
 * Depth is the one thing added rather than adapted: size, opacity and speed all
 * come off a single per-particle depth value, so small dots are dim and slow and
 * large ones are bright and quick. Independent randoms give you a field; one
 * shared random gives you distance.
 *
 * THE FIELD MUST SURVIVE A TAB SWITCH. Everything here lives in refs and the
 * setup effect runs once, on mount. It used to depend on `active`, which meant
 * every switch tore the whole thing down and rebuilt it: `resize()` saw its
 * size as changed (the closure's w/h had been reset to 0), so it re-assigned
 * canvas.width — which clears the canvas — and re-seeded every particle back to
 * its starting position. The field blanked for a frame and then teleported.
 * That was the flash.
 * ------------------------------------------------------------------------- */

const COUNT = 34;
const MIN_SIZE = 0.8;
const MAX_SIZE = 1.9;
const SPRITE = 64;          // sprite is drawn at 64px and scaled down, never up
/* How far past the dot the sprite's soft tail is allowed to reach. This is the
   number that decides whether the field reads as points of light or as smudges
   — at 7 the tails were wide enough to be blobs behind the Today card. */
const HALO = 4.2;


/* The original's hash. Keeping it means the field is identical on every open
   rather than reshuffling, which matters here — this sits under a dial you are
   reading, and a background that rearranges itself every time you glance at it
   is a background you notice. */
const seeded = (n) => Math.abs(Math.sin(n * 9999.123 + 78.233) * 43758.5453) % 1;

function makeSprite() {
  const c = document.createElement("canvas");
  c.width = c.height = SPRITE;
  const g = c.getContext("2d");
  const r = SPRITE / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  // solid core, then a long soft tail — a hard stop reads as a circle, this
  // reads as a point of light
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.22, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.16)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(r, r, r, 0, Math.PI * 2);
  g.fill();
  return c;
}

export default function Particles({ active }) {
  const canvasRef = useRef(null);
  const runRef = useRef({ start: null, stop: null });

  // ---- setup: once, on mount. Never keyed on `active`. --------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    const reduced = window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const sprite = makeSprite();
    /* Capped at 2 rather than taken from the device. A phone at DPR 3 makes
       this a ~3.6 megapixel surface to clear every frame, and these are soft
       dots with no edge that a third pixel could sharpen. */
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));

    let raf = 0;
    let w = 0;
    let h = 0;
    let particles = [];

    const seed = () => {
      particles = Array.from({ length: COUNT }, (_, i) => {
        // one depth per particle: 0 is far, 1 is near
        const depth = seeded(i + 5.5);
        const size = MIN_SIZE + depth * (MAX_SIZE - MIN_SIZE);
        const angle = seeded(i + 4.9) * Math.PI * 2;
        const speed = 0.05 + depth * 0.16;
        return {
          x: seeded(i + 1.3) * w,
          y: seeded(i + 2.7) * h,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size,
          alpha: 0.07 + depth * 0.13,
          dx: 0, dy: 0,          // last drawn position, for the dirty rect
        };
      });
    };

    /* How much of the field should be showing: exactly as much of the surface
       it belongs to as is currently showing.
 
       Reading it off the pane rather than re-deriving it is the point. Every
       previous attempt matched the pane's fade by writing the same duration,
       delay and easing somewhere else and trusting the two to agree — and each
       time the browser composited them out of step anyway. There is nothing to
       drift here: it is the same number. */
    let paneEl = null;
    const surfaceOpacity = () => {
      if (!paneEl || !paneEl.isConnected) {
        const sc = document.querySelector(".sess-scroll");
        paneEl = sc ? sc.closest(".pane") : null;
      }
      if (!paneEl) return 1;
      const cs = getComputedStyle(paneEl);
      if (cs.visibility === "hidden") return 0;
      const o = parseFloat(cs.opacity);
      return Number.isFinite(o) ? o : 1;
    };

    /* Clear only where something was drawn, not the whole surface.
 
       The field drifts the whole time the tab is up now, including through the
       entrance — a background that stops the moment you look away and only
       starts again a second and a half later is the thing that reads as frozen.
       So what a frame costs is what decides whether it can, and a full-surface
       clear is the expensive half of it: ~1.6 million pixels at DPR 2 on a
       phone, against a few thousand for thirty-four small rects. Same drawing,
       a fraction of the fill.
 
       Every clear happens before any draw. Doing them per particle in one pass
       would erase the neighbour that had already been drawn where two overlap. */
    let painted = false;
    const wipe = () => { ctx.clearRect(0, 0, w, h); painted = false; };

    const draw = (move, fade) => {
      if (painted) {
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          const box = p.size * HALO + 4;      // + antialiasing slack
          ctx.clearRect(p.dx - box / 2, p.dy - box / 2, box, box);
        }
        painted = false;
      }
      if (fade <= 0.001) return;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (move) {
          p.x += p.vx;
          p.y += p.vy;
          // wrap on all four edges, allowing for the sprite's soft margin
          const m = p.size * HALO;
          if (p.x < -m) p.x = w + m;
          else if (p.x > w + m) p.x = -m;
          if (p.y < -m) p.y = h + m;
          else if (p.y > h + m) p.y = -m;
        }
        // the sprite's core is a fraction of its box, so it is drawn well
        // wider than the dot and the tail does the rest
        const d = p.size * HALO;
        ctx.globalAlpha = p.alpha * fade;
        ctx.drawImage(sprite, p.x - d / 2, p.y - d / 2, d, d);
        p.dx = p.x; p.dy = p.y;              // where this one needs clearing next
      }
      ctx.globalAlpha = 1;
      painted = true;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const nw = Math.max(1, rect.width);
      const nh = Math.max(1, rect.height);
      if (nw === w && nh === h) return;
      /* Rescale what is already there rather than re-seeding. Assigning
         canvas.width clears the surface, so a re-seed on every resize would
         blank and teleport the field — which is what a tab switch used to do
         when this effect was torn down and rebuilt. */
      const first = w === 0;
      const sx = first ? 1 : nw / w;
      const sy = first ? 1 : nh / h;
      w = nw; h = nh;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (first) seed();
      else particles.forEach((p) => { p.x *= sx; p.y *= sy; });
      painted = false;           // assigning canvas.width already cleared it
      draw(false, surfaceOpacity());
    };

    const stop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };

    /* Two things run this loop and they are separate on purpose.
 
       DRIFT is the field doing its job. It runs for as long as the tab is up,
       and it is the reason the loop has no natural end.
 
       FOLLOW is the field matching the surface's opacity while that opacity is
       moving. It draws without advancing anything, and it stops as soon as the
       number reaches its target — which is how the field can leave with the
       tab and still be cleared once it has gone. */
    let drifting = false;
    let target = 0;           // where the surface's opacity is heading
    let deadline = 0;         // hard stop, so following can never spin

    const loop = () => {
      const fade = surfaceOpacity();
      draw(drifting, fade);
      const arrived = Math.abs(fade - target) <= 0.002 || performance.now() > deadline;
      if (!drifting && arrived) { if (fade <= 0.001) wipe(); raf = 0; return; }
      raf = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (raf || reduced || document.hidden) return;
      raf = requestAnimationFrame(loop);
    };
    /* A TARGET, not a threshold. Testing "has it settled at 0 or 1" looks
       equivalent and is exactly backwards: those are the values the fade STARTS
       from. Leaving, the first frame reads 1 and the loop quit on the spot,
       leaving the field painted at full strength over the outgoing surface —
       which is the flash, still there after three fixes aimed elsewhere.
       Arriving, the first frame reads 0 and it quit just as fast, leaving the
       canvas blank until the drift loop started a second later. */
    const follow = (to) => { target = to; deadline = performance.now() + 900; kick(); };
    const start = () => { drifting = true; kick(); };
    const halt = () => { drifting = false; };
    runRef.current = { start, stop, follow, halt };

    // A background that keeps animating in a backgrounded tab is a battery
    // bug, not a feature.
    /* Coming back has to work from every direction a browser offers, because
       they do not agree on which one fires. Backgrounding a tab gives you
       visibilitychange; minimising the window or switching apps on iOS can
       give you pageshow (out of the back/forward cache) or nothing but focus.
       Miss the one your browser used and the field is simply stopped — which
       is what "when I minimise it the same thing happens" is. */
    const resume = () => { if (!document.hidden && drifting) kick(); };
    const onVisibility = () => { if (document.hidden) stop(); else resume(); };
    /* The surface can change opacity without React telling us — the pane's
       fade is a CSS animation. Following it whenever a switch begins is what
       the run effect below arranges. */

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", resume);
    window.addEventListener("focus", resume);
    return () => {
      stop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("focus", resume);
      runRef.current = { start: null, stop: null, follow: null, halt: null };
    };
  }, []);

  /* ---- run ---------------------------------------------------------------
   * Follow the surface's opacity through every switch, in both directions, and
   * drift only once the entrance is over.
   *
   * The canvas has no CSS opacity of its own, no veil over it, and no animating
   * ancestor. Nothing about the layer changes, ever — the fade is in the
   * PIXELS. That is the whole point: a static layer cannot be composited out of
   * step with itself, which is what every previous version was asking a browser
   * not to do.
   * ---------------------------------------------------------------------- */
  useEffect(() => {
    const r = runRef.current;
    if (!r.follow) return undefined;
    if (!active) { r.halt(); r.follow(0); return undefined; }
    /* Drifting from the first frame, not after a delay. The delay existed to
       keep the canvas off the main thread during the entrance, and it worked —
       but it also meant the field stood still for a second and a half every
       time you came back to the tab, which is worse than the frames it saved.
       The dirty-rect clear above is what pays for it. */
    r.follow(1);
    r.start();
    return undefined;
  }, [active]);

  /* The canvas never animates, and it is still not what fades.
   *
   * Fading the canvas itself — by any route, its own transition or an animating
   * ancestor's group opacity — puts a compositing layer whose opacity is
   * changing over another whose opacity is also changing, and Safari paints the
   * canvas at full strength before the fade reaches it. But NOT fading it is
   * just as wrong the other way: the field then stands at full strength while
   * the pane above it is still at a third of its opacity, so for the length of
   * the handover you get bright dots over a ghost dial.
   *
   * So a veil does the fading. It is an opaque sheet of the page's own ground
   * colour sitting directly over the canvas, and it lifts on exactly the pane's
   * timing — the field appears as the dial appears. The thing being animated is
   * a plain solid-colour div, which composites the way anything does; the
   * canvas underneath it never changes at all.
   *
   * It costs one more layer of a single flat colour, and it is the only version
   * of this that is right in both directions at once. */
  return (
    <canvas
      ref={canvasRef}
      className="sess-particles"
      aria-hidden="true"
      role="presentation"
    />
  );
}
