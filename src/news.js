/* ---------------------------------------------------------------------------
 * The news wire.
 *
 * Financial Juice's RSS, the same feed the bot reads. Public and keyless — the
 * only reason it goes through a Worker is CORS: RSS servers do not send
 * Access-Control-Allow-Origin, so a browser cannot read one cross-origin at
 * all. See worker/news.js; there is no secret involved.
 *
 * Parsed with DOMParser rather than by hand. A wire headline can contain
 * ampersands, quotes, angle brackets and CDATA, and every one of those breaks a
 * regex that looked fine against the first twenty items. The browser ships a
 * real XML parser; using it is both less code and the only version that is
 * right on the item that eventually contains "<".
 *
 * Tolerant on purpose. RSS 2.0 is what this feed serves, but the reader accepts
 * Atom's element names too, and an item missing anything non-essential is kept
 * rather than dropped — a headline with no link is still a headline.
 * ------------------------------------------------------------------------- */

/* Configured in index.html, not baked into the bundle:
 *
 *     <meta name="news-feed" content="https://yser-news.<you>.workers.dev">
 *
 * Two reasons it lives there. Changing where the wire comes from is then an
 * edit to one line of HTML rather than a rebuild — and, more importantly, when
 * the meta is ABSENT this returns "" and the card does not render at all.
 *
 * That default is deliberate. The alternative — shipping a sample feed so the
 * card has something to show before the Worker exists — would put fabricated
 * headlines on a screen people read to find out what happened. An absent card
 * is honest; a card full of invented news is not, however clearly it is
 * labelled in a comment nobody reads. */
export const NEWS_URL = (typeof document !== "undefined"
  && document.querySelector('meta[name="news-feed"]')?.content) || "";

/* Poll interval, also from a meta so it can be tuned against the real wire
   without a rebuild:  <meta name="news-poll" content="15000">
   Fifteen seconds is the default because that matches the Worker's edge cache —
   polling faster than the cache refreshes just spends round trips to be told
   the same thing. */
export const NEWS_POLL_MS = (typeof document !== "undefined"
  && Number(document.querySelector('meta[name="news-poll"]')?.content)) || 15000;

/* Enough to fill the card several times over without holding a wire's worth of
   history in memory on a phone. */
const KEEP = 40;

const text = (node, ...names) => {
  for (const n of names) {
    const el = node.getElementsByTagName(n)[0];
    if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
  }
  return "";
};

/* Financial Juice stamps RFC-822 dates. Date.parse handles those and ISO 8601
   both; anything it cannot read becomes null rather than an Invalid Date that
   renders as "NaN minutes ago" three layers up. */
const when = (s) => {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

/**
 * XML string -> items, newest first.
 *
 * id is the stable identity across polls, and it matters more than it looks:
 * the card decides what is NEW by comparing ids, so an id that changes between
 * polls would re-animate the whole list every few seconds. guid when the feed
 * gives one, otherwise link, otherwise the headline itself.
 */
export function parseFeed(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  /* parsererror is how DOMParser reports malformed input — it does not throw.
     Without this check a truncated response becomes an empty list, which the
     card would show as "no news" rather than as a problem. */
  if (doc.getElementsByTagName("parsererror").length) throw new Error("feed is not valid XML");

  const nodes = [...doc.getElementsByTagName("item")];
  const list = (nodes.length ? nodes : [...doc.getElementsByTagName("entry")]).map((n) => {
    const title = text(n, "title");
    const link = text(n, "link") || (n.getElementsByTagName("link")[0] || {}).getAttribute?.("href") || "";
    const at = when(text(n, "pubDate", "published", "updated", "date"));
    return { id: text(n, "guid", "id") || link || title, title, link, at };
  }).filter((i) => i.title);

  /* Sorted here, not trusted from the feed. Most wires publish newest-first but
     it is not guaranteed, and one out-of-order item at the top of this card
     would read as the wire going backwards. Undated items keep their feed
     order at the end rather than being thrown away. */
  return list
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, KEEP);
}

/**
 * Poll the wire.
 *
 *   onItems(items)          whenever the list actually changed
 *   onStatus({state, at})   "loading" | "live" | "down"
 *
 * Returns { close, refresh }.
 *
 * ETag is what makes this cheap enough to poll quickly. An unchanged feed comes
 * back 304 with no body, so a fast interval costs a round trip and nothing
 * else — which is how "live" and "not hammering a free Worker" coexist.
 */
export function createWire({
  url = NEWS_URL,
  every = NEWS_POLL_MS,
  onItems,
  onStatus = () => {},
  fetcher = (u, o) => fetch(u, o),
} = {}) {
  let timer = 0;
  let shut = false;
  let etag = null;
  let fails = 0;

  const tick = async () => {
    if (shut) return;
    try {
      const res = await fetcher(url, {
        headers: etag ? { "If-None-Match": etag } : {},
        cache: "no-store",
      });
      if (res.status === 304) {                    // nothing new, and no body
        fails = 0;
        onStatus({ state: "live", at: Date.now() });
      } else if (res.ok) {
        const tag = res.headers.get("ETag");
        if (tag) etag = tag;
        const items = parseFeed(await res.text());
        fails = 0;
        onStatus({ state: "live", at: Date.now() });
        onItems(items);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      fails += 1;
      onStatus({ state: "down", at: Date.now(), error: String(e.message || e) });
    }
    if (shut) return;
    /* Back off on failure so a wire that is down does not get polled every
       fifteen seconds forever, but never past a minute — this is the surface
       people are watching to find out something happened. */
    const wait = fails ? Math.min(every * 2 ** Math.min(fails, 2), 60000) : every;
    timer = setTimeout(tick, wait);
  };

  onStatus({ state: "loading", at: 0 });
  tick();

  return {
    close() { shut = true; if (timer) clearTimeout(timer); },
    refresh() { if (timer) clearTimeout(timer); fails = 0; tick(); },
  };
}

/* How long ago, in the shortest form that is still honest. Seconds up to a
   minute, because on a wire the difference between "now" and "40s" is the
   whole point. */
export function ago(at, now = Date.now()) {
  if (!at) return "";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 10) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
