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
        };
      });
    };

    const draw = (move) => {
      ctx.clearRect(0, 0, w, h);
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
        ctx.globalAlpha = p.alpha;
        ctx.drawImage(sprite, p.x - d / 2, p.y - d / 2, d, d);
      }
      ctx.globalAlpha = 1;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const nw = Math.max(1, rect.width);
      const nh = Math.max(1, rect.height);
      if (nw === w && nh === h) return;
      w = nw; h = nh;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
      draw(false);
    };

    const tick = () => { draw(true); raf = requestAnimationFrame(tick); };
    const stop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };
    const start = () => {
      if (raf || reduced || !active || document.hidden) return;
      raf = requestAnimationFrame(tick);
    };

    // A background that keeps animating in a backgrounded tab is a battery
    // bug, not a feature.
    const onVisibility = () => { if (document.hidden) stop(); else start(); };

    resize();
    start();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      className={`sess-particles${active ? " on" : ""}`}
      aria-hidden="true"
      role="presentation"
    />
  );
}
