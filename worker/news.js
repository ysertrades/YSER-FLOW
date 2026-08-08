/* ---------------------------------------------------------------------------
 * Cloudflare Worker: the news pipe.
 *
 * WHY THIS EXISTS AT ALL, given the feed is free and needs no key.
 *
 * CORS. Financial Juice's RSS is public, but like essentially every RSS server
 * it does not send Access-Control-Allow-Origin, so a browser on another origin
 * cannot read a single byte of it. Not rate-limited, not forbidden — refused
 * before the request is even made. Your bot never meets this because it runs
 * server-side, where same-origin policy does not apply. The app is a page, so
 * it does.
 *
 * That is the whole reason. There is no secret in here.
 *
 * IT IS A DUMB PIPE, ON PURPOSE. It does not parse. RSS is XML, Workers have no
 * DOMParser, and hand-rolled regex over someone else's XML is a bug waiting for
 * a headline with an angle bracket in it. The browser has a real XML parser
 * that is faster and more correct than anything that would fit here, so the
 * Worker fetches, caches and adds three headers. Twenty lines you can read in
 * one sitting and never have to trust again.
 *
 * QUICK IS THE CACHE. Every visitor collapses onto one upstream fetch per
 * TTL window, served from Cloudflare's edge near them rather than from
 * financialjuice.com. And the ETag passes straight through, so a client that
 * already has the current feed gets a 304 with no body at all.
 *
 * Deploy:
 *   npx wrangler deploy worker/news.js --name yser-news --compatibility-date 2026-01-01
 * then set NEWS_URL in src/news.js to the Worker's URL.
 * ------------------------------------------------------------------------- */

const FEED = "https://www.financialjuice.com/feed.ashx?xy=rss";

/* Seconds the edge holds a copy. Financial Juice publishes constantly, but a
   headline that is fifteen seconds old is not stale to a human reading it, and
   this is the difference between one upstream request per window and one per
   visitor per poll. */
const TTL = 15;

/* Only these origins get an allow header. A public CORS proxy is exactly what
   this is NOT: leaving it open turns your Worker into free bandwidth for
   anyone who finds the URL, on your quota. */
const ALLOWED = [
  "https://ysertrades.github.io",
  "https://whop.com",
  "http://127.0.0.1:8907",
  "http://localhost:8907",
];

const cors = (origin) => ({
  "Access-Control-Allow-Origin": ALLOWED.includes(origin) ? origin : ALLOWED[0],
  "Access-Control-Allow-Headers": "If-None-Match",
  "Access-Control-Expose-Headers": "ETag",
  Vary: "Origin",
});

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    if (request.method !== "GET") {
      return new Response("GET only", { status: 405, headers: cors(origin) });
    }

    let upstream;
    try {
      upstream = await fetch(FEED, {
        /* cf.cacheTtl is what makes this cheap: Cloudflare serves the cached
           copy without leaving the edge, so a thousand readers are one request
           to financialjuice.com every TTL seconds. */
        cf: { cacheTtl: TTL, cacheEverything: true },
        headers: {
          /* Some feed hosts return 403 to a bare fetch with no UA. */
          "User-Agent": "yser-flow/1.0 (+https://ysertrades.github.io)",
          Accept: "application/rss+xml, application/xml, text/xml",
        },
      });
    } catch (e) {
      /* 502 rather than a 200 with an empty body. A client that cannot tell
         "no news" from "the feed is down" will show an empty list as if the
         world went quiet, which is the same class of lie as a frozen price. */
      return new Response("upstream unreachable", { status: 502, headers: cors(origin) });
    }

    /* THE RATE LIMIT IS THE ONE UPSTREAM STATUS WORTH HANDLING BY NAME.
     *
     * Cloudflare fronts this feed and answers 429 with a retry-after if it is
     * polled too hard. Ignoring that gets the Worker locked out, which delivers
     * the news LATER rather than sooner — the opposite of what leaning on it
     * was for. Passing the 429 and its retry-after through means the client's
     * own backoff is driven by the number the origin actually asked for
     * instead of one guessed here.
     *
     * A Worker is shared by every visitor, so it is also the right place for
     * this: one instance being told to go quiet quietens everybody, which is
     * exactly the behaviour that keeps the limit from being hit again. */
    if (upstream.status === 429) {
      const retry = upstream.headers.get("Retry-After") || "60";
      return new Response("rate limited upstream", {
        status: 429,
        headers: { ...cors(origin), "Retry-After": retry },
      });
    }

    if (!upstream.ok) {
      return new Response(`upstream ${upstream.status}`, {
        status: 502, headers: cors(origin),
      });
    }

    const etag = upstream.headers.get("ETag");
    /* Hand the client's validator upstream and pass a 304 straight back — an
       unchanged feed then costs no body on either hop. */
    if (etag && request.headers.get("If-None-Match") === etag) {
      return new Response(null, { status: 304, headers: { ...cors(origin), ETag: etag } });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...cors(origin),
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": `public, max-age=${TTL}`,
        ...(etag ? { ETag: etag } : {}),
      },
    });
  },
};
