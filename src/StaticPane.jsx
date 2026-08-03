import { useEffect, useState } from "react";

/**
 * Hosts one of the vendored static tools (the card editor, the guide) in an
 * iframe.
 *
 * Two properties matter and are easy to lose in a refactor:
 *
 *  1. Lazy — nothing loads until the tab is first opened, so the shell still
 *     boots as fast as the calculator alone.
 *  2. Permanent — once mounted the <iframe> element is never removed. Hiding
 *     uses visibility, never display:none, which is a documented iframe-reload
 *     hazard in some WebKit versions. This is what keeps the user's loaded
 *     screenshot, crop, zoom and every control value alive across tab switches.
 *
 * The pane reserves space for the tab bar rather than letting the frame run
 * underneath it, which also keeps the guide's own bottom nav clear of it.
 * Safe-area insets do not propagate into an iframe, so they are applied here.
 */
export default function StaticPane({ active, src, title, background }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (active) setMounted(true);
  }, [active]);

  if (!mounted) return null;

  return (
    <div
      className={`pane${active ? "" : " pane-hidden"}`}
      aria-hidden={!active}
    >
      <iframe
        className="pane-frame"
        style={background ? { background } : undefined}
        src={`${import.meta.env.BASE_URL}${src}`}
        title={title}
        allow="clipboard-write; web-share"
      />
    </div>
  );
}
