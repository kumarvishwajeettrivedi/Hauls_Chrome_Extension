// Deterministic synthetic Amazon product pages (routed, no real network) + seed helpers.
export const D = 864e5;
export const inr = n => "₹" + Math.round(n).toLocaleString("en-IN");
export const dshort = t => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
export const monthKey = (d = new Date()) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
export const key = id => `amazon.in:${id}`;
export const seedItem = (id, hist, extra = {}) => ({ [key(id)]: { site: "Amazon", title: "boAt Airdopes 141 Bluetooth Earbuds", url: `https://www.amazon.in/dp/${id}`, hist, ...extra } });

// Page the extension's Amazon extractor understands (#productTitle, #corePrice_feature_div .a-price .a-offscreen, .basisPrice).
export async function routeProduct(ctx, { id, price, mrp, title = "boAt Airdopes 141 Bluetooth Earbuds", seller = null, ratings = null, offerLine = 0 }) {
  const html = `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${title}</title></head><body>
<div id=dp-container><div id=centerCol><span id=productTitle>${title}</span><a id="bylineInfo" href="/stores/x">Visit the ${(title.split(" ")[0] || "Brand")} Store</a>
<div id=corePrice_feature_div><span class="a-price"><span class="a-offscreen">${inr(price)}</span><span aria-hidden=true>${inr(price)}</span></span></div>
${mrp ? `<span class="basisPrice"><span class="a-offscreen">${inr(mrp)}</span></span>` : ""}
${offerLine ? `<div id="ppd"><span>Buy for ₹${offerLine}</span><span>Buy for ₹${offerLine + 900} + cashback</span></div>` : ""}
${ratings ? `<span id="acrCustomerReviewText">${ratings.total} ratings</span><span aria-label="${ratings.avg} out of 5 stars"></span>${[5, 4, 3, 2, 1].map(k => `<a aria-label="${ratings.dist[k]} percent of reviews have ${k} stars"></a>`).join("")}` : ""}
${seller ? `<div offer-display-feature-name="desktop-fulfiller-info"><span class="offer-display-feature-text">${seller.ships || ""}</span></div><div><a id="sellerProfileTriggerId" href="/gp/aag/main?seller=AJ6SIZC8YQDZX&isAmazonFulfilled=${seller.fba ? 1 : 0}">${seller.name}</a></div>` : ""}</div></div></body></html>`;
  await ctx.route(`https://www.amazon.in/dp/${id}*`, r => r.fulfill({ status: 200, contentType: "text/html", body: html }));
  return `https://www.amazon.in/dp/${id}`;
}

// Histories whose verdict is known from analysis.js (page price is the *current* price).
export const verdictCases = now => [
  { id: "B0VERDBUY1", want: "Buy", meter: 4, price: 800, hist: [[now - 60 * D, 1000], [now - 40 * D, 1100], [now - 20 * D, 1000], [now - 36e5, 800]] },
  { id: "B0VERDWAI1", want: "Wait", meter: 1, low: true, price: 1200, hist: [[now - 60 * D, 1000], [now - 40 * D, 1000], [now - 20 * D, 1000]] },
  { id: "B0VERDFAI1", want: "Fair", meter: 3, price: 1050, hist: [[now - 60 * D, 1050], [now - 40 * D, 1000], [now - 20 * D, 1050], [now - 36e5, 1050]] },
  { id: "B0VERDEAR1", want: "Early", meter: 0, price: 500, hist: [] },
];

// Synthetic JSON-LD product page for the extra shops (url = exact product URL, route ignores any query/hash).
export async function routeLd(ctx, url, { price, mrp, title = "Test Mechanical Keyboard" }) {
  const ld = { "@context": "https://schema.org", "@type": "Product", name: title, image: "https://example.com/i.jpg", offers: { "@type": "Offer", price: String(price), priceCurrency: "INR", ...(mrp ? { highPrice: String(mrp) } : {}) } };
  const html = `<!doctype html><html><head><meta charset=utf-8><title>${title}</title><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><h1>${title}</h1></body></html>`;
  await ctx.route(url + "*", r => r.fulfill({ status: 200, contentType: "text/html", body: html }));
  return url;
}

// Fake Supabase for https://*.supabase.co/**. Records every call in `calls`; `fail` makes the watchlist POST return 500.
export async function fakeSupabase(ctx, { fail = false } = {}) {
  const calls = [], api = { calls, fail };
  await ctx.route("https://*.supabase.co/**", async r => {
    const q = r.request(), u = new URL(q.url()), body = q.postData(), rec = { method: q.method(), path: u.pathname + u.search, body: body ? (() => { try { return JSON.parse(body); } catch { return body; } })() : null };
    calls.push(rec);
    const json = (status, v) => r.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(v) });
    if (q.method() === "OPTIONS") return r.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (api.fail && u.pathname.includes("/ext_watchlist") && q.method() === "POST") return json(500, { message: "boom" });
    if (u.pathname.includes("/ext_watchlist") && q.method() === "POST") return json(201, []);
    if (u.pathname.includes("/ext_watchlist")) return json(200, []);
    if (u.pathname.includes("/ext_profiles")) return json(200, [{ plan: "free", contribute: true, name: "Test User" }]);
    if (u.pathname.includes("/ext_remote_config")) return json(200, [{ value: { disabled_stores: [] } }]);
    if (u.pathname.includes("/rpc/ext_price_history")) return json(200, []);
    return json(200, null);
  });
  return api;
}
export const SESSION = { access_token: "fake-access", refresh_token: "fake-refresh", expires_at: Date.now() + 36e5 * 24, user: { id: "00000000-0000-0000-0000-000000000001", email: "tester@example.com", name: "Test User" } };
