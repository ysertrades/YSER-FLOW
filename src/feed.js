/* ---------------------------------------------------------------------------
 * The price feed.
 *
 * BTC and ETH, over a public exchange WebSocket. No key, no account, no server
 * — which is the whole reason these two are first. This app is a static bundle
 * on Pages, so anything it holds is public; crypto is the only asset class with
 * a real-time feed that does not need a secret to reach it.
 *
 * WHY THERE ARE TWO SOURCES. Not redundancy for its own sake. Exchange
 * endpoints get geo-blocked (Binance refuses US traffic outright), fall over,
 * and get filtered by corporate and school networks — and the failure is silent
 * from the page's side: the socket simply never opens. One source means one
 * network policy away from a permanently empty card, on somebody's phone, with
 * no way for them to tell it is not just broken. If the first source has not
 * produced a tick within FAILOVER_MS the feed moves to the next and keeps
 * going.
 *
 * The interface is deliberately narrow — subscribe, get quotes, get a status —
 * because the source behind it is expected to change. Adding FX or futures
 * later is a new entry in SOURCES and nothing else: no component, no stylesheet
 * and no test moves.
 * ------------------------------------------------------------------------- */

/* The pairs, and how many decimals each one is quoted to. dp is fixed per pair
   rather than derived from the tick, because a price that changes its decimal
   count changes its width, and a number that changes width makes the row it
   sits in twitch on every update. */
export const PAIRS = [
  { key: "btc", label: "BTC", dp: 2 },
  { key: "eth", label: "ETH", dp: 2 },
];

/* No tick this long after connecting and the source is presumed unreachable.
   Generous: BTC and ETH both trade many times a second, so six seconds of
   silence on a healthy feed does not happen. */
const FAILOVER_MS = 6000;
/* No tick this long while connected and the card says so rather than standing
   there showing a confident, frozen number. */
export const STALE_MS = 12000;
/* Reconnect backoff, capped. A socket that retries in a tight loop on a captive
   portal is a battery bug with extra steps. */
const BACKOFF = [1000, 2000, 4000, 8000, 15000];

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

export const SOURCES = [
  {
    /* Coinbase first: US-legal, keyless, and quoted in real USD rather than a
       stablecoin, so the number on screen is the number people mean. */
    name: "coinbase",
    url: "wss://ws-feed.exchange.coinbase.com",
    hello: () => JSON.stringify({
      type: "subscribe",
      product_ids: ["BTC-USD", "ETH-USD"],
      channels: ["ticker"],
    }),
    parse: (d) => {
      if (!d || d.type !== "ticker") return null;
      const key = d.product_id === "BTC-USD" ? "btc"
        : d.product_id === "ETH-USD" ? "eth" : null;
      const price = num(d.price);
      if (!key || price === null) return null;
      /* Coinbase sends the 24h open rather than a change percent, so the
         percent is derived here — one place, so the card never has to know
         which source it is looking at. */
      const open = num(d.open_24h);
      return {
        key, price,
        changePct: open ? ((price - open) / open) * 100 : null,
      };
    },
  },
  {
    name: "kraken",
    url: "wss://ws.kraken.com/v2",
    hello: () => JSON.stringify({
      method: "subscribe",
      params: { channel: "ticker", symbol: ["BTC/USD", "ETH/USD"] },
    }),
    parse: (d) => {
      if (!d || d.channel !== "ticker" || !Array.isArray(d.data) || !d.data.length) return null;
      const row = d.data[0];
      const key = row.symbol === "BTC/USD" ? "btc"
        : row.symbol === "ETH/USD" ? "eth" : null;
      const price = num(row.last);
      if (!key || price === null) return null;
      return { key, price, changePct: num(row.change_pct) };
    },
  },
];

/**
 * Open a feed.
 *
 *   onQuote({ key, price, changePct })   every tick, unthrottled — throttling
 *                                        is the caller's business, because only
 *                                        the caller knows what it costs to draw
 *   onStatus({ state, source })          "connecting" | "live" | "down"
 *
 * Returns { close } . Staleness is NOT decided in here: a socket that has gone
 * quiet looks identical to one on a quiet market from this side, and only the
 * thing rendering knows how old is too old. It gets the timestamps; it decides.
 */
export function createFeed({
  onQuote,
  onStatus = () => {},
  sources = SOURCES,
  connect = (url) => new WebSocket(url),
} = {}) {
  let idx = 0;
  let ws = null;
  let retry = 0;
  let watchdog = 0;
  let timer = 0;
  let shut = false;
  let gotOne = false;

  const clearTimers = () => {
    if (watchdog) { clearTimeout(watchdog); watchdog = 0; }
    if (timer) { clearTimeout(timer); timer = 0; }
  };

  const drop = () => {
    clearTimers();
    if (ws) {
      /* Unhook before closing. A closing socket still fires onclose, and an
         onclose that runs the reconnect path is how one dead source turns into
         two live sockets racing each other. */
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try { ws.close(); } catch (e) { /* already gone */ }
      ws = null;
    }
  };

  const advance = () => {
    idx = (idx + 1) % sources.length;
    /* Backoff only counts full trips around the list. Moving from a blocked
       source to a working one should be immediate — the wait is for "everything
       is unreachable", not for "the first one was not it". */
    if (idx === 0) retry = Math.min(retry + 1, BACKOFF.length - 1);
    const wait = idx === 0 ? BACKOFF[retry] : 0;
    timer = setTimeout(open, wait);
  };

  function open() {
    if (shut) return;
    drop();
    const src = sources[idx];
    gotOne = false;
    onStatus({ state: "connecting", source: src.name });
    try { ws = connect(src.url); } catch (e) { advance(); return; }

    ws.onopen = () => { try { ws.send(src.hello()); } catch (e) { /* closing */ } };
    ws.onmessage = (ev) => {
      let d;
      try { d = JSON.parse(ev.data); } catch (e) { return; }
      const q = src.parse(d);
      if (!q) return;
      if (!gotOne) {
        gotOne = true;
        retry = 0;
        if (watchdog) { clearTimeout(watchdog); watchdog = 0; }
        onStatus({ state: "live", source: src.name });
      }
      onQuote(q);
    };
    /* Both paths go to the next source. An error that does not close, and a
       close with no error, are the same thing to us: this one is not working. */
    ws.onerror = () => { if (!shut) { drop(); onStatus({ state: "down", source: src.name }); advance(); } };
    ws.onclose = () => { if (!shut) { drop(); onStatus({ state: "down", source: src.name }); advance(); } };

    watchdog = setTimeout(() => {
      if (shut || gotOne) return;
      drop();
      onStatus({ state: "down", source: src.name });
      advance();
    }, FAILOVER_MS);
  }

  open();
  return {
    close() { shut = true; drop(); },
    /* for tests: which source is being used right now */
    current: () => sources[idx].name,
  };
}

/* ---------------------------------------------------------------------------
 * The range.
 *
 * What the card is actually for. A last price under a killzone dial is the same
 * strip every app has; the high and low built SINCE THE WINDOW OPENED is the
 * thing you came to that screen to know.
 *
 * Pure and keyed, so the caller does not have to remember to reset it: hand it
 * the id of the period you are in, and it starts a new range whenever that id
 * changes. The id is the open window's key while one is running and the ET date
 * otherwise, which means the range resets at the session boundary — the moment
 * it stops meaning anything.
 * ------------------------------------------------------------------------- */
export function foldRange(prev, { id, price, at }) {
  if (!prev || prev.id !== id) return { id, hi: price, lo: price, from: at };
  if (price > prev.hi) return { ...prev, hi: price };
  if (price < prev.lo) return { ...prev, lo: price };
  return prev;
}

/* Where price sits between the low and the high, 0..1. Flat markets would divide
   by zero, and a range of exactly nothing is honestly the middle. */
export function rangePos(lo, hi, price) {
  if (!(hi > lo)) return 0.5;
  return Math.min(1, Math.max(0, (price - lo) / (hi - lo)));
}
