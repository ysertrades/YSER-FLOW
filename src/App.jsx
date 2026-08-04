import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Calculator from "./Calculator";
import StaticPane from "./StaticPane";
import TabBar from "./TabBar";
import { useAutoHideOnScroll, usePrefersReducedMotion } from "./useShellHooks";

/**
 * Shell. Holds the tab and renders all three surfaces at once — nothing is
 * ever conditionally unmounted:
 *
 *   - the calculator, because SessionBlock's staggered entrance animation
 *     replays on remount and looks jumpy
 *   - the editor, because it holds the user's loaded screenshot and framing
 *   - the guide, because it holds your place in the deck
 */
export default function App() {
  const [tab, setTab] = useState("flow");
  const flowScrollY = useRef(0);
  // Where the Back button in the guide returns you to.
  const cameFrom = useRef("flow");

  const reduced = usePrefersReducedMotion();
  // Only the calculator scrolls the document; the other two are iframes whose
  // scrolling the parent never sees. Under reduced motion the bar stays put.
  const barHidden = useAutoHideOnScroll({ active: tab === "flow" && !reduced });

  const goTab = useCallback((next) => {
    setTab((cur) => {
      if (next === cur) return cur;
      if (cur === "flow") flowScrollY.current = window.scrollY;
      if (next === "guide") cameFrom.current = cur;
      return next;
    });
  }, []);

  // The guide is a destination, not a pane: it takes the whole screen and the
  // switcher gets out of the way, so its own nav pill carries the only exit.
  // It asks for it by postMessage — same origin, since it is served from our
  // own BASE_URL. guide:close is the older name the editor's panel used to
  // answer; honoured so an out-of-date vendored copy still gets out.
  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "guide:back" || d.type === "guide:close") {
        goTab(cameFrom.current || "flow");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [goTab]);

  // Hiding .wrap with display:none collapses the document height, so the
  // browser clamps scrollY to 0. Without this the calculator jumps back to the
  // top every time you leave and return. Do not remove.
  useLayoutEffect(() => {
    if (tab === "flow") window.scrollTo(0, flowScrollY.current);
  }, [tab]);

  return (
    <>
      <div className="bg-layer" aria-hidden="true" />

      <Calculator hidden={tab !== "flow"} />

      <StaticPane
        active={tab === "card"}
        src="card/index.html"
        title="Trade card editor"
        background="#eeeeee"  /* the editor's own body colour, so its first
                                 paint is already right and the dark-to-light
                                 switch does not flash */
      />
      <StaticPane
        active={tab === "guide"}
        src="card/guide.html"
        title="Trades card editor field guide"
        background="#07090e"  /* the guide's own ground, behind its cards */
      />

      {/* Hidden on the guide tab, using the same slide-away the bar already
          performs on scroll. Reading is the one thing here that deserves the
          whole screen. */}
      <TabBar tab={tab} onChange={goTab} hidden={barHidden || tab === "guide"} />
    </>
  );
}
