// Other sellers on the same Amazon product. Runs in the service worker on a user click: one request to Amazon's own offers fragment.
// Pure parser (offParseAod) + fetch layer (offFind). Text from the page is untrusted: capped and tag-stripped here.
const OFF_TIMEOUT = 8000, OFF_TTL = 15 * 60e3, offCache = new Map();
const offText = h => String(h || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&#x27;/g, "'").replace(/\s+/g, " ").trim();
function offParseAod(html) {
  const chunks = String(html || "").split(/(?=<div id="aod-offer")/).slice(1), out = [];
  for (const c of chunks) {
    const price = (c.match(/id="aod-price-\d+"[\s\S]*?a-price-whole">([\d,]+)/) || [])[1], p = price ? parseFloat(price.replace(/,/g, "")) : null;
    const sold = c.match(/id="aod-offer-soldBy"[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([^<]{2,80})</), name = sold ? offText(sold[2]).slice(0, 80) : "", sid = sold ? (sold[1].match(/[?&;]seller=([A-Z0-9]{8,16})/) || [])[1] || null : null;
    if (!p || !(p < 1e7) || !name) continue;
    const ships = (c.match(/id="aod-offer-shipsFrom"[\s\S]*?Ships from<\/span>[\s\S]*?class="[^"]*a-color-base[^"]*">([^<]{2,60})</) || c.match(/id="aod-offer-shipsFrom"[\s\S]*?a-col-right[^>]*>([\s\S]{0,300}?)<\/div>/) || [])[1],
      cond = (c.match(/id="aod-offer-heading"[\s\S]*?a-text-bold">\s*([^<]+?)\s*</) || [])[1], rate = c.match(/Seller rating is (\d(?:\.\d)?) out of 5 stars[\s\S]{0,200}?\((\d[\d,]*) ratings?\)/);
    out.push({ price: p, cond: offText(cond || "New").slice(0, 30), seller: name, sid, ships: offText(ships || "").slice(0, 60), rating: rate ? parseFloat(rate[1]) : null, ratings: rate ? parseInt(rate[2].replace(/,/g, ""), 10) : 0 });
  }
  return out;
}
// Lowest New offer and how much cheaper it is than the price on this page.
function offBest(offers, here) {
  const fresh = (offers || []).filter(o => /^new/i.test(o.cond)); if (!fresh.length) return null;
  const lowest = fresh.reduce((a, o) => (o.price < a.price ? o : a), fresh[0]);
  return { lowest, saving: here > lowest.price ? Math.round(here - lowest.price) : 0 };
}
async function offFind({ asin }, doFetch = fetch, now = Date.now()) {
  if (!/^[A-Z0-9]{10}$/.test(asin || "")) return { offers: [], failed: true };
  const hit = offCache.get(asin); if (hit && now - hit.at < OFF_TTL) return { offers: hit.offers, failed: false };
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), OFF_TIMEOUT);
  try {
    const r = await doFetch(`https://www.amazon.in/gp/product/ajax/aodAjaxMain/ref=dp_aod_ALL_mbc?asin=${asin}&pc=dp&experienceId=aodAjaxMain`, { credentials: "include", signal: ctl.signal, headers: { "x-requested-with": "XMLHttpRequest" } });
    if (!r.ok) throw new Error("http " + r.status);
    const offers = offParseAod(await r.text()).sort((a, b) => a.price - b.price); offCache.set(asin, { at: now, offers }); return { offers, failed: false };
  } catch { return { offers: [], failed: true }; } finally { clearTimeout(t); }
}
if (typeof module !== "undefined") module.exports = { offParseAod, offBest, offFind, offCache };
