import { useLayoutEffect, useRef, useState } from "react";
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

  const reduced = usePrefersReducedMotion();
  // Only the calculator scrolls the document; the other two are iframes whose
  // scrolling the parent never sees. Under reduced motion the bar stays put.
  const barHidden = useAutoHideOnScroll({ active: tab === "flow" && !reduced });

  const goTab = (next) => {
    if (next === tab) return;
    if (tab === "flow") flowScrollY.current = window.scrollY;
    setTab(next);
  };

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
        background="#07090e"  /* the guide's own ground */
      />

      <TabBar tab={tab} onChange={goTab} hidden={barHidden} />
    </>
  );
}
