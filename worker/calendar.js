/* ---------------------------------------------------------------------------
 * Cloudflare Worker: the calendar pipe.
 *
 * ONLY DEPLOY THIS IF YOU NEED IT. The app asks faireconomy.media directly
 * first, and if that host sends Access-Control-Allow-Origin there is nothing
 * for this to do — see CAL_URL in src/calendar.js. This exists for the case
 * where it does not.
 *
 * WHY IT WOULD BE NEEDED, given the feed is free and needs no key: CORS. A
 * static host that does not send that header cannot be read by a browser on
 * another origin at all — not rate-limited, not forbidden, refused before the
 * request is made. A bot never meets this because it runs server-side, where
 * same-origin policy does not apply. The app is a page, so it does.
 *
 * That is the whole reason. There is no secret in here.
 *
 * IT IS A DUMB PIPE, ON PURPOSE. It does not parse and it does not filter —
 * US-only and high-impact-only both happen in the browser, where they are two
 * lines and easy to change. The Worker fetches, caches at the edge and adds
 * three headers. Twenty lines you can read in one sitting and never have to
 * trust again.
 *
 * QUICK IS THE CACHE. Every visitor collapses onto one upstream fetch per
 * TTL window, served from Cloudflare's edge near them rather than from the feed
 * host. And the ETag passes straight through, so a client that
 * already has the current feed gets a 304 with no body at all.
 *
 * Deploy:
 *   npx wrangler deploy worker/calendar.js --name yser-cal --compatibility-date 2026-01-01
 * then add <meta name="cal-feed" content="<the URL it prints>"> to index.html.
 * ------------------------------------------------------------------------- */

const FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

/* Seconds the edge holds a copy. Financial Juice publishes constantly, but a
   week's schedule barely moves — only `actual` changes, and only at the moment
   of a release. Thirty seconds is well inside that and collapses every visitor
   onto one upstream request per window. */
const TTL = 30;

/* Only these origins get an allow header. A public CORS proxy is exactly what
   this is NOT: leaving it open turns your Worker into free bandwidth for
   anyone who finds the URL, on your quota. */
/* NOT whop.com, and that was a mistake worth spelling out. A fetch made from
   inside an iframe carries the IFRAME's origin, not the parent page's — the
   embed is served from Pages, so every request arrives as
   https://ysertrades.github.io however it is framed. Listing the host that
   frames you does nothing; listing the host that serves you is the whole job.
   Add a domain here only if you actually serve the app from it. */
const ALLOWED = [
  "https://ysertrades.github.io",
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
           upstream every TTL seconds. */
        cf: { cacheTtl: TTL, cacheEverything: true },
        headers: {
          /* Some feed hosts return 403 to a bare fetch with no UA. */
          "User-Agent": "yser-flow/1.0 (+https://ysertrades.github.io)",
          Accept: "application/json",
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
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${TTL}`,
        ...(etag ? { ETag: etag } : {}),
      },
    });
  },
};
