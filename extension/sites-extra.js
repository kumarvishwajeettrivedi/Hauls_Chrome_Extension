// Extra Indian shops (price tracking data). Verified live with Playwright on 2026-10-17; read-only, no logins.
// id(URL) -> product id or null (listing/home/search). ld = stock parseLd() finds a Product offer price.
// Meesho: SKIPPED (Akamai "Access Denied" on search from automation; not evaded) -> deliberately absent.
const m = (u, re) => (u.pathname.match(re) || [])[1] || null;
const EXTRA_SITES = {
  // ponytail: Croma's Product JSON-LD has raw control chars (invalid JSON) so ld:false; fix = strip \u0000-\u001f in parseLd before JSON.parse. Price is in .amount text; MRP is not struck-through.
  "croma.com": { name: "Croma", id: u => m(u, /\/p\/(\d+)\/?$/), search: "https://www.croma.com/searchB?text=", color: "#12D8B0", ld: false, verified: "2026-10-17" },
  "reliancedigital.in": { name: "Reliance Digital", id: u => m(u, /^\/product\/[^/]+-(\d+)\/?$/), search: "https://www.reliancedigital.in/products?q=", color: "#E42529", ld: true, verified: "2026-10-17" },
  "tatacliq.com": { name: "Tata CLiQ", id: u => m(u, /\/p-(mp\d+)\/?$/i), search: "https://www.tatacliq.com/search/?searchCategory=all&text=", color: "#B60D2B", ld: true, verified: "2026-10-17" },
  "nykaa.com": { name: "Nykaa", id: u => m(u, /\/p\/(\d+)\/?$/), search: "https://www.nykaa.com/search/result/?q=", color: "#FC2779", ld: true, verified: "2026-10-17" },
  // /p/261632/slug and /p/P260811/260813/slug
  "vijaysales.com": { name: "Vijay Sales", id: u => m(u, /^\/p\/(P?\d+)\//), search: "https://www.vijaysales.com/search-listing?q=", color: "#E31E24", ld: true, verified: "2026-10-17" },
  "snapdeal.com": { name: "Snapdeal", id: u => m(u, /^\/product\/[^/]+\/(\d+)\/?$/), search: "https://www.snapdeal.com/search?keyword=", color: "#E40046", ld: true, verified: "2026-10-17" },
};
if (typeof module !== "undefined") module.exports = { EXTRA_SITES };
globalThis.EXTRA_SITES = EXTRA_SITES;
