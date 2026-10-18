// Product matching (pure). "Is this listing the same product as the one on the page?" Conservative by design: an unexplained match is worse than no match.⁠​‌‌‌​‌‌​​‌‌​‌​​‌​‌‌‌​​‌‌​‌‌​‌​​​​‌‌‌​‌‌‌​‌‌​​​​‌​‌‌​‌​‌​​‌‌​​‌​‌​‌‌​​‌​‌​‌‌‌​‌​​​​‌‌‌​‌​​​‌‌​‌​​​​‌‌​​​​​​‌‌​​‌​​‌‌​​‌​‌​‌‌​​‌​‌​‌‌​​‌​‌​​‌‌​​‌​​‌‌​​‌​​⁡
// mtFacts(title, brand) extracts comparable facts; mtCompare(src, cand) returns {verdict: "exact"|"likely"|null, why, conflicts}. Gold set: tests/unit/match.test.js.
// Names are prefixed mt* (one shared global scope in the service worker and the content script).
const MT_GENERIC = new Set("the a an and or with for of in on to by from new latest buy online india mobile phone smartphone camera control wireless bluetooth mic tws ear buds earbuds earphones headphones headset laptop tv television smart led qled oled uhd display screen men mens women womens kids boys girls unisex ai edition pro-grade standard original genuine combo set pack black white blue red green grey gray silver gold pink purple yellow orange brown beige navy maroon titanium natural desert midnight starlight lavender sage ultramarine teal mist ocean amber charcoal cosmic".split(" "));
const MT_VARIANT = new Set("plus pro max ultra mini lite fe se air go neo anc elite prime turbo gt xl cellular lte digital disc slim regular skinny relaxed straight oversized bootcut tapered".split(" "));
const MT_ALIAS = { xiaomi: ["redmi", "poco", "mi"], amazon: ["kindle", "echo", "fire", "alexa"], samsung: ["galaxy"], sony: ["playstation", "bravia", "xperia"], apple: ["iphone", "ipad", "macbook", "airpods", "imac"], google: ["pixel", "nest"], oneplus: ["nord"], realme: ["narzo"] };
const MT_REJECT = /\b(case|cover|covers|protector|tempered|screen guard|skin|skins|faceplate|refurbished|renewed|used|pre-owned|preowned|open box|spare|replacement|combo|hong kong|international version|verizon|at&t|t-mobile|sprint|us version|usa version|locked|esim only)\b/;
const MT_FOR = /\b(for|compatible with|fits?|suitable for|designed for)\s+(?:the\s+)?(?:[a-z0-9+]+\s+){0,3}/;
const MT_FIT = new Set("slim regular skinny relaxed straight oversized bootcut tapered cellular lte digital disc".split(" "));
const MT_SPEC = /^\d+(\.\d+)?(gb|tb|mb|inch|l|ml|kg|g|w|mah|hz|mp|h|cm|mm|v|years?|pack\d+|nm|db|ms|ton|star)$/;
function mtNorm(t) {
  return String(t || "").slice(0, 400).toLowerCase().replace(/[’']/g, "").replace(/[™®©]/g, "").replace(/&amp;/g, "&").replace(/[“”″"]/g, '"')
    .replace(/(\d{1,6}(?:\.\d{1,4})?)\s*(gb|tb|mb)\b/g, "$1$2").replace(/(\d{1,6}(?:\.\d{1,4})?)\s*(?:inches|inch|")/g, "$1inch").replace(/([a-z0-9])\+(?=[\s)\],]|$)/g, "$1 plus ").replace(/(\d{1,6}(?:\.\d{1,4})?)\s*tons?\b/g, "$1ton").replace(/(\d{1,6}(?:\.\d{1,4})?)\s*(?:litres|litre|liters|liter|ltrs|ltr|l)\b/g, (m, n) => (+n * 1000) + "ml").replace(/(\d{1,6}(?:\.\d{1,4})?)\s*kg\b/g, (m, n) => (+n * 1000) + "g")
    .replace(/(\d{1,6}(?:\.\d{1,4})?)\s*(ml|kg|gm|g|cm|mm|hz|mp|mah)\b/g, (m, n, u) => n + (u === "gm" ? "g" : u)).replace(/\b([a-z]+\d+[a-z0-9]*)\/\d{1,3}\b/g, "$1").replace(/\b([a-z]{1,4})-(\d{3,}[a-z0-9]*)\b/g, "$1$2").replace(/(\d+)\s*(?:watts|watt|w)\b/g, "$1w").replace(/(\d{1,6}(?:\.\d{1,4})?)\s*(?:hours|hrs|hr|h)\b/g, "$1h")
    .replace(/(?:pack|set|combo)\s*of\s*(\d+)|(\d+)\s*(?:pack|pcs|pieces|units)\b/g, (m, a, b) => " pack" + (a || b) + " ").replace(/(?:(\d)(?:st|nd|rd|th)\s*gen|gen(?:eration)?\s*(\d))\b/g, (m, a, b) => " gen" + (a || b) + " ");
}
const mtWords = t => mtNorm(t).split(/[^a-z0-9.]+/).map(x => x.replace(/^\.+|\.+$/g, "")).filter(Boolean);
const mtHead = t => String(t || "").split(/[:,(|;]|\s[-–—]\s|\swith\s|\s\+\s/i)[0];
const mtAlnum = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const mtSet = (words, re) => new Set(words.filter(w => re.test(w)));
function mtEd1(a, b) { if (a === b) return false; if (Math.abs(a.length - b.length) > 1) return false; let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1); return (a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i)); }
const MT_CPU_FAM = /\b(ryzen\s?\d|core\s?i\d|core\s?ultra\s?\d|core\s?\d|celeron|pentium|athlon|apple\s?m\d)\b/g; // laptop CPUs only: phone chips are implied by the model
// A version word (pro, plus, ultra, fe, slim...) only counts next to the model number ("16 Pro", "S24 Ultra"), not in marketing copy ("Pro Sound").
function mtFacts(title, brand, mpn) {
  title = String(title || "").slice(0, 400);
  const norm = mtNorm(title), all = mtWords(title), head = mtWords(mtHead(title)).slice(0, 9), tag = new Set(all);
  const b = mtAlnum(brand);
  const strong = all.slice(0, 40).filter(w => /^(?=.*[a-z])(?=.*\d)[a-z0-9]{5,}$/.test(w) && !MT_SPEC.test(w) && !/^pack\d+$/.test(w) && !/^\d{4,5}[a-z]{1,2}$/.test(w));
  const model = head.filter(w => /\d/.test(w) && !MT_SPEC.test(w) && !/^pack\d+$/.test(w) && !/^[2-6]g$/.test(w) && w !== "gen" && !/^\d{1,2}(h|w)$/.test(w) && !/^\d+\.\d+$/.test(w)).slice(0, 4).concat(strong.filter(w => !head.includes(w)).slice(0, 2));
  const mi = head.findIndex(w => model.includes(w)), lead = (mi < 0 ? [] : head.slice(0, mi)).find(w => !/\d/.test(w) && !MT_GENERIC.has(w) && !MT_VARIANT.has(w) && mtAlnum(w) !== b && w.length > 2 && !/^(mens|womens|men|women)$/.test(w)) || "";
  const series = head.filter(w => !/\d/.test(w) && !MT_GENERIC.has(w) && mtAlnum(w) !== b && w.length > 1).slice(0, 5);
  const text = norm.replace(/\s+/g, " "), fam = [...(text.match(MT_CPU_FAM) || [])].map(x => x.replace(/\s+/g, "")), codes = [...(text.match(/\b\d{4,5}[a-z]{1,2}\b/g) || [])];
  const storage = mtSet(all.slice(0, 40), /^\d+(gb|tb)$/), inch = (text.match(/(\d+(?:\.\d+)?)inch/) || [])[1], pack = (text.match(/pack(\d+)/) || [])[1] || "1";
  const cap = mtSet(all.slice(0, 40), /^\d+(\.\d+)?(ml|g)$/), extra = { ton: mtSet(all, /^\d+(\.\d+)?ton$/), mah: mtSet(all.slice(0, 40), /^\d+mah$/), mm: mtSet(all.slice(0, 40), /^\d+(\.\d+)?mm$/), star: mtSet(all.slice(0, 40), /^\d+star$/), size: mtSet(all.slice(-8), /^(xs|s|m|l|xl|xxl|xxxl)$/), gender: new Set([...mtSet(all.slice(0, 40), /^(men|mens|women|womens|boys|girls|kids|unisex)$/)].map(g => g.replace(/s$/, ""))) };
  const raw160 = text.slice(0, 200), kit = /\b(kit lens|lens kit|with \d{2}-?\d{0,3}\s?mm lens|\d{2}-\d{2,3}mm lens)\b/.test(raw160), body = /\b(body only|body without|camera body|without lens)\b/.test(raw160);
  return { mpn: /\d/.test(mtAlnum(mpn)) && mtAlnum(mpn).length >= 5 ? mtAlnum(mpn) : "", brand: b, model, lead, series, variants: new Set(head.filter((w, i) => MT_VARIANT.has(w) && !(w === "air" && /^(fryer|purifier|conditioner|cooler|bud|buds|pods|fryers)$/.test(head[i + 1] || "")) && (!model.length || model.some(m => { const k = head.indexOf(m), fit = MT_FIT.has(w); return k >= 0 && i >= k - 1 && i <= k + (fit ? 5 : 2); })))), storage, inch: inch ? +inch : null, cap, extra, kit, body, bad: MT_REJECT.test(raw160) ? (raw160.match(MT_REJECT) || [])[1] || "x" : "", pack, fam: new Set(fam), codes: new Set(codes), tokens: tag, head,
    bundle: /\s\+\s/.test(String(title || "").slice(0, 160)), lang: (text.match(/\b(hindi|marathi|tamil|telugu|bengali|gujarati|kannada|malayalam|punjabi|urdu|spanish|french|german)\b/) || [])[1] || "" };
}
const mtHas = (cand, b) => { if (!b) return true; const t = mtAlnum(cand.title); return t.includes(b) || mtAlnum(cand.brand).includes(b) || (MT_ALIAS[b] || []).some(a => t.includes(a)); };
// verdict: "exact" (brand + model + every spec we know agree), "likely" (no conflict, some spec the listing does not state), null (anything else)
const srcTitleHint = src => (src.head || []).join(" ");
function mtCompare(src, cand) {
  const c = mtFacts(cand.title, src.brand || cand.brand), why = [], conflicts = [];
  if (!src.brand) return { verdict: null, why: ["page brand unknown"], conflicts: [] };
  if (!mtHas(cand, src.brand)) return { verdict: null, why: [], conflicts: ["brand"] };
  // model numbers: every identifying token on the page must appear in the listing, and the listing's own must not differ by a digit/letter
  const ctoks = new Set(c.head.concat(mtWords(cand.title).slice(0, 30)));
  const suffixOk = m => [...ctoks].some(x => x.startsWith(m) && x.length - m.length >= 2 && x.length - m.length <= 3 && /\d/.test(x.slice(m.length)) && /[a-z]/.test(m)); // WW80T4040 -> WW80T4040CE1 (market/colour suffix); NA120 -> NA1200 stays different
  const missing = src.model.filter(m => !ctoks.has(m) && !suffixOk(m)); if (missing.length) conflicts.push("model " + missing.join("/"));
  for (const m of src.model) for (const x of c.model) if (m !== x && (mtEd1(m, x) || (/^\d+$/.test(m) && /^\d+/.test(x) && x.startsWith(m)) || (/^\d+$/.test(x) && /^\d+/.test(m) && m.startsWith(x)))) conflicts.push(`model ${m} vs ${x}`);
  if (src.lead && !ctoks.has(src.lead)) conflicts.push("name " + src.lead); // the product line word (revolution, galaxy, airdopes) must appear
  if (!src.model.length) { const a = new Set(src.series), bb = new Set(c.series), inter = [...a].filter(x => bb.has(x)).length, uni = new Set([...a, ...bb]).size; if (!a.size || inter / uni < 0.75) conflicts.push("name"); }
  if ([...src.variants].sort().join() !== [...c.variants].sort().join()) conflicts.push("version");
  if (src.storage.size && c.storage.size) { const okS = [...c.storage].every(x => src.storage.has(x)) && [...src.storage].some(x => c.storage.has(x)); if (!okS) conflicts.push("storage"); }
  if (src.inch && c.inch && Math.abs(src.inch - c.inch) > 1) conflicts.push("screen size");
  if (src.cap.size && c.cap.size && ![...src.cap].some(x => c.cap.has(x))) conflicts.push("capacity");
  if (src.pack !== c.pack) conflicts.push("pack size");
  if (src.fam.size && c.fam.size && ![...src.fam].some(x => c.fam.has(x))) conflicts.push("processor");
  if (src.codes.size && c.codes.size && ![...src.codes].some(x => c.codes.has(x))) conflicts.push("processor model");
  if (c.lang && c.lang !== src.lang) conflicts.push("language");
  if (c.bundle && !src.bundle) conflicts.push("bundle");
  if (c.bad && !src.bad) conflicts.push("accessory or used (" + c.bad + ")");
  { const ct = mtNorm(cand.title), m2 = ct.match(/\b(?:for|compatible with|fits?|suitable for|designed for)\s+((?:[a-z0-9+]+\s+){0,3})/); if (m2 && !mtNorm(srcTitleHint(src)).includes(" for ") && [src.brand, src.lead, ...src.model].filter(Boolean).some(x => mtAlnum(m2[1]).includes(x))) conflicts.push("accessory (for " + m2[1].trim() + ")"); }
  for (const k of ["ton", "mah", "mm", "star", "size", "gender"]) { const a = src.extra[k], b2 = c.extra[k]; if (a.size && b2.size && ![...a].some(x => b2.has(x))) conflicts.push(k === "mm" ? "case size" : k); }
  if ((src.kit || c.kit || src.body || c.body) && (src.kit !== c.kit || src.body !== c.body)) conflicts.push("kit / body only");
  if (conflicts.length) return { verdict: null, why, conflicts };
  if (src.mpn && mtAlnum(cand.title).includes(src.mpn)) return { verdict: "exact", why: ["model number"], conflicts, mpnHit: true }; // the page's own model number appears in the listing: strongest evidence we can read
  const known = [src.storage.size && !c.storage.size ? "storage" : "", src.fam.size && !c.fam.size ? "processor" : ""].filter(Boolean); // screen size / capacity are implied by the model, storage and CPU are not
  return { verdict: src.model.length || src.series.length >= 2 || (src.series.length >= 1 && (src.cap.size || src.pack !== "1" || src.storage.size)) ? (known.length ? "likely" : "exact") : null, why: known.map(k => k + " not stated"), conflicts };
}

// What was checked, for the "same product" panel. ok: true = agrees, null = the listing does not say, false = differs (info rows only; hard conflicts never reach here).
const MT_COLOURS = new Set("black white blue red green grey gray silver gold pink purple yellow orange brown beige navy maroon titanium natural desert midnight starlight lavender sage ultramarine teal amber charcoal cosmic".split(" "));
const mtColours = t => new Set(mtWords(t).filter(w => MT_COLOURS.has(w)));
function mtChecks(src, cand, srcTitle) {
  const c = mtFacts(cand.title, cand.brand), rows = [], up = x => String(x).toUpperCase(), same = (a, b) => [...a].some(x => b.has(x));
  rows.push({ k: "Brand", v: cand.brand || src.brand, ok: true });
  if (src.mpn && mtAlnum(cand.title).includes(src.mpn)) rows.push({ k: "Model no.", v: src.mpn.toUpperCase(), ok: true });
  rows.push({ k: "Model", v: src.model.length ? src.model.map(up).join(" ") : src.series.slice(0, 2).join(" "), ok: true });
  rows.push({ k: "Version", v: src.variants.size ? [...src.variants].join(" ") : "Standard", ok: true });
  if (src.storage.size) rows.push({ k: "Storage", v: [...src.storage].map(up).join(" / "), ok: c.storage.size ? true : null });
  if (src.inch) rows.push({ k: "Screen", v: src.inch + '"', ok: c.inch ? true : null });
  if (src.cap.size) rows.push({ k: "Size", v: [...src.cap].map(up).join(" / "), ok: c.cap.size ? true : null });
  if (src.pack !== "1" || c.pack !== "1") rows.push({ k: "Pack", v: "×" + src.pack, ok: true });
  if (src.fam.size) rows.push({ k: "Processor", v: [...src.fam][0], ok: c.fam.size ? true : null });
  const a = mtColours(srcTitle || ""), b = mtColours(cand.title); if (a.size && b.size) rows.push({ k: "Colour", v: same(a, b) ? [...a][0] : "differs", ok: same(a, b), info: true });
  return rows;
}
if (typeof module !== "undefined") module.exports = { mtChecks, mtFacts, mtCompare, mtNorm, mtWords, mtHead };
