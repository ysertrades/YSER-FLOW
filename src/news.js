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
   without a rebuild:  <meta name="news-poll" content="20000">
 *
 * TWENTY SECONDS, and faster is not better. The endpoint sits behind Cloudflare
 * and answers 429 with a retry-after if you lean on it, so polling harder gets
 * you locked out — which delivers the news LATER, not sooner. Twenty is the
 * cadence the bot runs in production and it holds. This was 15000, chosen to
 * match the Worker's cache TTL, which was the wrong thing to match it to. */
export const NEWS_POLL_MS = (typeof document !== "undefined"
  && Number(document.querySelector('meta[name="news-poll"]')?.content)) || 20000;

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

/* Financial Juice stamps RFC-822 dates, always GMT. Date.parse handles those
   and ISO 8601 both; anything it cannot read becomes null rather than an
   Invalid Date that renders as "NaN minutes ago" three layers up. */
const when = (s) => {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

/* ENTITIES ARRIVE DOUBLE-ENCODED, and this is not a theoretical worry — the raw
 * feed carries "S&amp;amp;P 500" for "S&P 500". An HTML-escaped &amp; that was
 * then XML-escaped on top of that.
 *
 * DOMParser undoes exactly one layer, which is correct XML behaviour and leaves
 * "S&amp;P 500" sitting in the text node. Rendered, that is the literal string
 * S&amp;P 500 on screen — which is what this app shipped doing.
 *
 * So: decode again, in a loop, until the string stops changing. Capped, because
 * a crafted input could otherwise keep producing new entities forever. &amp;
 * is unescaped LAST or "&amp;lt;" would collapse to "<" in a single pass and
 * lose a level. */
function decodeAgain(s) {
  for (let i = 0; i < 5; i += 1) {
    const next = s
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&(?:apos|#39);/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
      .replace(/&amp;/g, "&");
    if (next === s) return s;
    s = next;
  }
  return s;
}

/* Every title on this wire is prefixed "FinancialJuice: ". The card already
   says where the wire comes from in its header, so repeating it on all five
   rows spends a third of the width on the same word.
   {{NewsID}} and friends are their own templating leaking through unfilled. */
const clean = (t) => decodeAgain(t)
  .replace(/^\s*FinancialJuice:\s*/i, "")
  .replace(/\{\{\s*\w+\s*\}\}/g, "")
  .replace(/\s{2,}/g, " ")
  .trim();

/* Worth styling louder. Their own convention, and cheap to honour. */
const isBreaking = (t) => /\b(?:breaking|urgent)\b/i.test(t);

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
    const raw = text(n, "title");
    const title = clean(raw);
    const link = text(n, "link") || (n.getElementsByTagName("link")[0] || {}).getAttribute?.("href") || "";
    const at = when(text(n, "pubDate", "published", "updated", "date"));
    /* guid on this wire is a bare numeric article id, not a URL — which makes
       it a perfect dedupe key, and it is what the card compares to decide what
       is new. Falling back to the link and then the headline keeps that working
       on a feed that omits it. */
    return {
      id: text(n, "guid", "id") || link || title,
      title, link, at, breaking: isBreaking(raw),
    };
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
    /* Stamped at the START of the request, not after it resolves.
     *
     * Scheduling the next poll from the moment this one FINISHED makes the real
     * period `every + latency`, and that quietly compounds against anything
     * upstream that also measures from a finish — a cache that will not refetch
     * until its TTL has elapsed since its last fetch completed will refuse the
     * poll that arrives a few milliseconds late, and the effective interval
     * doubles with nothing in the log to say so. Fifty milliseconds of latency
     * is enough to turn a twenty-second feed into a forty-second one. */
    const started = Date.now();
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
      } else if (res.status === 429) {
        /* Obey the number we were given rather than our own backoff curve. The
           origin knows how long it wants to be left alone, and guessing shorter
           is how a rate limit turns into a lockout — which delivers the news
           later, not sooner. */
        const secs = parseInt(res.headers.get("Retry-After"), 10);
        onStatus({ state: "down", at: Date.now(), error: "rate limited" });
        if (shut) return;
        timer = setTimeout(tick, (Number.isFinite(secs) ? secs : 60) * 1000 + 2000);
        return;
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      fails += 1;
      onStatus({ state: "down", at: Date.now(), error: String(e.message || e) });
    }
    if (shut) return;
    /* Back off on failure so a wire that is down does not get polled every
       twenty seconds forever, but never past a minute — this is the surface
       people are watching to find out something happened. */
    const wait = fails ? Math.min(every * 2 ** Math.min(fails, 2), 60000) : every;
    /* Measured from `started`, so a slow response eats into the gap rather than
       being added to it. Floored at a second so a pathologically slow request
       cannot turn this into a tight loop. */
    timer = setTimeout(tick, Math.max(1000, started + wait - Date.now()));
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
