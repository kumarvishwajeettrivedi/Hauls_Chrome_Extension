// Product-id extraction for extension/sites-extra.js: real product URLs -> id, listing/home URLs -> null.
const { EXTRA_SITES } = require("../../extension/sites-extra.js");
let bad = 0; const t = (n, ok) => { if (!ok) { bad++; console.log("FAIL", n); } };
const P = {
  "croma.com": [["https://www.croma.com/amazon-echo-dot-5th-gen-with-built-in-alexa-smart-wi-fi-speaker-ambient-temperature-sensor-blue-/p/269862", "269862"], ["https://www.croma.com/xiaomi-4-lite-smart-air-purifier-with-remote-control-alexa-google-home-enabled-white-/p/303011", "303011"], ["https://www.croma.com/croma-81-28-cm-32-inch-1-star-led-hd-ready-smart-linux-tv-with-a+-grade-panel-2026-model-/p/323445", "323445"]],
  "reliancedigital.in": [["https://www.reliancedigital.in/product/hammer-wave-10-w-bluetooth-speaker-black-mlgmac-9901297", "9901297"], ["https://www.reliancedigital.in/product/zebronics-buddy-150-40-watts-portable-bluetooth-speaker-mq6le4-10141526?internal_source=search_results", "10141526"], ["https://www.reliancedigital.in/product/xiaomi-sound-outdoor-bluetooth-speaker-black-mhosos-9570188", "9570188"]],
  "tatacliq.com": [["https://www.tatacliq.com/marshall-kilburn-iii-portable-bluetooth-speaker-brown/p-mp000000032311072", "mp000000032311072"], ["https://www.tatacliq.com/jbl-clip-5-wireless-ultra-portable-bluetooth-speaker-without-mic-black/p-mp000000030024923", "mp000000030024923"], ["https://www.tatacliq.com/jbl-flip-7-wireless-portable-bluetooth-speaker-blue/p-mp000000030024988", "mp000000030024988"]],
  "nykaa.com": [["https://www.nykaa.com/maybelline-new-york-serum-matte-lipstick-8hr-hydration/p/24700514?productId=24700514&pps=1", "24700514"], ["https://www.nykaa.com/m-a-c-matte-mini-lipstick/p/15100008", "15100008"], ["https://www.nykaa.com/kay-beauty-hydra-luscious-hydrating-lip-gloss-stain/p/29726519?skuId=26221832", "29726519"]],
  "vijaysales.com": [["https://www.vijaysales.com/p/261632/goboult-mustang-thunder-wireless-headphones-silver-black", "261632"], ["https://www.vijaysales.com/p/P260811/260813/sennheiser-momentum-5-wireless-over-ear-headphones-denim", "P260811"], ["https://www.vijaysales.com/p/197712/bluestar-375-l-5-star-vertical-visi-cooler-white", "197712"]],
  "snapdeal.com": [["https://www.snapdeal.com/product/neo-hedu-sh12-bluetooth-bluetooth/628071201910", "628071201910"], ["https://www.snapdeal.com/product/uddo-sh12-neckband-wireless-with/622121593015#bcrumbSearch:headphones", "622121593015"], ["https://www.snapdeal.com/product/neo-p9-bluetooth-bluetooth-headphone/628462315382", "628462315382"]],
};
const N = {
  "croma.com": ["https://www.croma.com/", "https://www.croma.com/smart-devices/c/3002", "https://www.croma.com/searchB?text=speaker"],
  "reliancedigital.in": ["https://www.reliancedigital.in/", "https://www.reliancedigital.in/products", "https://www.reliancedigital.in/products?q=bluetooth%20speaker"],
  "tatacliq.com": ["https://www.tatacliq.com/", "https://www.tatacliq.com/search/?searchCategory=all&text=bluetooth%20speaker"],
  "nykaa.com": ["https://www.nykaa.com/", "https://www.nykaa.com/makeup/lips/c/15", "https://www.nykaa.com/brands/nykaa-cosmetics/c/1937?ptype=brand&id=1937"],
  "vijaysales.com": ["https://www.vijaysales.com/", "https://www.vijaysales.com/c/headphones", "https://www.vijaysales.com/product-listing-page"],
  "snapdeal.com": ["https://www.snapdeal.com/", "https://www.snapdeal.com/search?keyword=headphones", "https://www.snapdeal.com/products/men-apparel#bcrumbSearch:headphones"],
};
for (const [d, s] of Object.entries(EXTRA_SITES)) {
  for (const k of ["name", "id", "search", "color", "ld", "verified"]) t(`${d} has ${k}`, s[k] !== undefined);
  t(`${d} types`, typeof s.id === "function" && typeof s.ld === "boolean" && /^#[0-9A-Fa-f]{6}$/.test(s.color) && s.search.startsWith("https://"));
  t(`${d} verified`, /^\d{4}-\d\d-\d\d$/.test(s.verified) || /^skipped: ./.test(s.verified));
  t(`${d} has >=3 product urls`, (P[d] || []).length >= 3); t(`${d} has >=2 non-product urls`, (N[d] || []).length >= 2);
  for (const [u, id] of P[d] || []) t(`${d} ${u} -> ${id}`, s.id(new URL(u)) === id);
  for (const u of N[d] || []) t(`${d} ${u} -> null`, s.id(new URL(u)) === null);
}
t("all 6 working sites present", Object.keys(P).every(d => EXTRA_SITES[d]));
t("meesho absent (skipped)", !EXTRA_SITES["meesho.com"]);
console.log(bad ? `${bad} FAILED` : "sites: all ok"); process.exit(bad ? 1 : 0);
