// Product matching (pure). "Is this listing the same product as the one on the page?" Conservative by design: an unexplained match is worse than no match.⁠​‌‌‌​‌‌​​‌‌​‌​​‌​‌‌‌​​‌‌​‌‌​‌​​​​‌‌‌​‌‌‌​‌‌​​​​‌​‌‌​‌​‌​​‌‌​​‌​‌​‌‌​​‌​‌​‌‌‌​‌​​​​‌‌‌​‌​​​‌‌​‌​​​​‌‌​​​​​​‌‌​​‌​​‌‌​​‌​‌​‌‌​​‌​‌​‌‌​​‌​‌​​‌‌​​‌​​‌‌​​‌​​⁡
// mtFacts(title, brand) extracts comparable facts; mtCompare(src, cand) returns {verdict: "exact"|"likely"|null, why, conflicts}. Gold set: tests/unit/match.test.js.
// Names are prefixed mt* (one shared global scope in the service worker and the content script).
const MT_GENERIC = new Set("the a an and or with for of in on to by from new latest buy online india mobile phone smartphone camera control wireless bluetooth mic tws ear buds earbuds earphones headphones headset laptop tv television smart led qled oled uhd display screen men mens women womens kids boys girls unisex ai edition pro-grade standard original genuine combo set pack black white blue red green grey gray silver gold pink purple yellow orange brown beige navy maroon titanium natural desert midnight starlight lavender sage ultramarine teal mist ocean amber charcoal cosmic".split(" "));
const MT_VARIANT = new Set("shield plus pro max ultra mini lite fe se air go neo anc elite prime turbo gt xl cellular lte digital disc slim regular skinny relaxed straight oversized bootcut tapered".split(" "));
const MT_ALIAS = { xiaomi: ["redmi", "poco", "mi"], amazon: ["kindle", "echo", "fire", "alexa"], samsung: ["galaxy"], sony: ["playstation", "bravia", "xperia"], apple: ["iphone", "ipad", "macbook", "airpods", "imac"], google: ["pixel", "nest"], oneplus: ["nord"], realme: ["narzo"] };
const MT_REJECT = /\b(cable|cables|cord|tripod|stylus|lanyard|case|cover|covers|protector|tempered|screen guard|skin|skins|faceplate|refurbished|renewed|used|pre-owned|preowned|open box|spare|replacement|straps?|watch bands?|sport band|sport loop|ear tips?|sleeve|pouch|combo|hong kong|international version|verizon|at&t|t-mobile|sprint|us version|usa version|locked|esim only)\b/;
// A summary / workbook / journal of a book is another book.
const MT_BOOK_OTHER = /\b(summary|study guide|workbook|journal|notebook|planner|analysis|audiobook|box set|collection|combo)\b/;
const MT_COUNT = /^(jars?|mics?|burners?|doors?|seaters?|speakers?|blades?|layers?|pcs|pieces?|sets?|ways?|tiers?|shelf|shelves|drawers?|buttons?|ports?|speeds?|stages?|slices?|cups?|persons?|seats?|bags?|packs?|in|colou?rs?|modes?|programs?|presets?|menus?|zones?|channels?|cores?|cameras?|fans?|rooms?|wheels?|bottles?|trays?|racks?|compartments?|lights?|years?|yrs?)$/; // a bare number before one of these is a quantity ("4 Jar", "3 Burner", "2 in 1"), not a model number
const MT_NOUN = new Set("usb power adapter charger cable running casual formal sports sneakers shoes shirt jeans trousers watch speaker headphones bottle".split(" ")); // category words: a name made only of these identifies nothing
const MT_FIT = new Set("slim regular skinny relaxed straight oversized bootcut tapered cellular lte digital disc".split(" "));
const MT_SPEC = /^\d+(\.\d+)?(gb|tb|mb|inch|l|ml|kg|g|w|m|mah|hz|mp|h|cm|mm|v|years?|pack\d+|nm|db|ms|ton|star|pct)$/;
function mtNorm(t) {
  return String(t || "").slice(0, 400).toLowerCase().replace(/[’']/g, "").replace(/[™®©]/g, "").replace(/&amp;/g, "&").replace(/(\d)\s*%/g, "$1pct").replace(/[“”″"]/g, '"')
    .replace(/(\d{1,6}(?:\.\d{1,4})?)\s*(gb|tb|mb)\b/g, "$1$2").replace(/(\d{1,6}(?:\.\d{1,4})?)\s*(?:inches|inch|")/g, "$1inch").replace(/([a-z0-9])\+(?=[\s)\],]|$)/g, "$1 plus ").replace(/(\d{1,6}(?:\.\d{1,4})?)\s*tons?\b/g, "$1ton").replace(/(?<![a-z0-9.\-])(\d{1,6}(?:\.\d{1,4})?)\s*(?:litres|litre|liters|liter|ltrs|ltr|l)\b/g, (m, n) => (+n * 1000) + "ml").replace(/(\d{1,6}(?:\.\d{1,4})?)\s*kg\b/g, (m, n) => (+n * 1000) + "g")
    .replace(/(\d{1,6}(?:\.\d{1,4})?)\s*(ml|kg|gm|g|cm|mm|hz|mp|mah)\b/g, (m, n, u) => n + (u === "gm" ? "g" : u)).replace(/\b([a-z]+\d+[a-z0-9]*)\/\d{1,3}\b/g, "$1").replace(/\b([a-z]{1,4})-(\d{3,}[a-z0-9]*)\b/g, "$1$2").replace(/\b([a-z]{1,3}\d{4,5})-(\d{3})\b/g, "$1$2").replace(/\b(\d{5})-(\d{4})\b/g, "$1$2").replace(/(\d+)\s*(?:watts|watt|w)\b/g, "$1w").replace(/(?<![a-z0-9.\-])(\d{1,3}(?:\.\d{1,2})?)\s*(?:meters|metres|meter|metre|mtrs|mtr|m)\b/g, "$1m").replace(/(\d)\s*(?:volts|volt|v)\b/g, "$1v").replace(/(\d{1,6}(?:\.\d{1,4})?)\s*(?:hours|hrs|hr|h)\b/g, "$1h")
    .replace(/(?:pack|set|combo)\s*of\s*(\d+)|(\d+)\s*(?:pack|pcs|pieces|units)\b/g, (m, a, b) => " pack" + (a || b) + " ").replace(/(?:(\d{1,2})(?:st|nd|rd|th)\s*gen(?:eration)?|gen(?:eration)?\s*(\d{1,2}))(?!\d)\b/g, (m, a, b) => " gen" + (a || b) + " ")
    .replace(/\b(air|ear|smart|power|sound|head|hand|face|hair|pen|hard)\s+(fryers?|buds|watch|bank|bar|phones|wash|dryer|drive|disk|purifier|straightener)\b/g, "$1$2"); // compound words: "Air Fryer" = "Airfryer", "Power Bank" = "Powerbank"
}
const mtWords = t => mtNorm(t).split(/[^a-z0-9.]+/).map(x => x.replace(/^\.+|\.+$/g, "")).filter(Boolean);
const mtHead = t => String(t || "").split(/[:,(|;]|\s[-–—]\s|\swith\s|\s\+\s/i)[0];
const mtAlnum = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const mtSet = (words, re) => new Set(words.filter(w => re.test(w)));
function mtEd1(a, b) { if (a === b) return false; if (Math.abs(a.length - b.length) > 1) return false; let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1); return (a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i)); }
const MT_CPU_FAM = /\b(ryzen\s?\d|core\s?i\d|core\s?ultra\s?\d|core\s?\d|celeron|pentium|athlon|apple\s?m\d)\b/g; // laptop CPUs only: phone chips are implied by the model
// A version word (pro, plus, ultra, fe, slim...) only counts next to the model number ("16 Pro", "S24 Ultra"), not in marketing copy ("Pro Sound").
// A model CODE is one token with letters and digits (50NU870BPLA, NA120/00, WH-CH520, SM-M356B). A product-line NAME is words, or one word plus a small number ("Airdopes 141", "Airdopes141", "Galaxy S24"): not proof of identity.
const mtCode = m => { const r = String(m == null ? "" : m).trim(); return r.length >= 5 && r.length <= 30 && !/\s/.test(r) && /\d/.test(r) && /[A-Za-z]/.test(r) && !/^[A-Za-z]{4,}[-/]?\d{1,4}$/.test(r); };
function mtFacts(title, brand, mpn) {
  title = String(title || "").slice(0, 400);
  const norm = mtNorm(title), all = mtWords(title), head = mtWords(mtHead(title)).slice(0, 9), tag = new Set(all);
  const b = mtAlnum(brand), cnt = {}; for (const m of norm.matchAll(/\b(\d{1,2})\s*-?\s*(jars?|burners?|doors?|seaters?|speakers?|blades?|layers?|tiers?|drawers?|seats?|zones?|channels?|cores?|wheels?|slices?|cups?)\b/g)) cnt[m[2].replace(/s$/, "")] = m[1];
  const strong = all.slice(0, 40).filter(w => /^(?=.*[a-z])(?=.*\d)[a-z0-9]{5,}$/.test(w) && !MT_SPEC.test(w) && !/^pack\d+$/.test(w) && !/^\d{4,5}[a-z]{1,2}$/.test(w) && !/^(gen|win|windows|office|offic|mso|ddr|lpddr|usb|hdmi|wifi|bt|ipx?|hdr|uhd|fhd|qled|oled)\d/.test(w));
  const model = head.filter((w, i) => /\d/.test(w) && !(/^\d+$/.test(w) && MT_COUNT.test(head[i + 1] || "")) && !MT_SPEC.test(w) && !/^pack\d+$/.test(w) && !/^[2-6]g$/.test(w) && w !== "gen" && !/^\d{1,2}(h|w)$/.test(w) && !/^\d+\.\d+$/.test(w)).slice(0, 4).concat(strong.filter(w => !head.includes(w)).slice(0, 2));
  const mi = head.findIndex(w => model.includes(w)), lead = (mi < 0 ? [] : head.slice(0, mi)).find(w => !/\d/.test(w) && !MT_GENERIC.has(w) && !MT_VARIANT.has(w) && mtAlnum(w) !== b && w.length > 2 && !/^(mens|womens|men|women)$/.test(w)) || "";
  const series = head.filter(w => !/\d/.test(w) && !MT_GENERIC.has(w) && !MT_COUNT.test(w) && mtAlnum(w) !== b && w.length > 1).slice(0, 5);
  const text = norm.replace(/\s+/g, " "), fam = [...(text.match(MT_CPU_FAM) || [])].map(x => x.replace(/\s+/g, "")), codes = [...(text.match(/\b\d{4,5}[a-z]{1,2}\b/g) || [])];
  const storage = mtSet(all.slice(0, 40), /^\d+(gb|tb)$/), sg = [...storage].map(x => parseFloat(x) * (/tb$/.test(x) ? 1024 : 1)).sort((x, y) => x - y), // rom = the biggest figure; ram = the small ones next to it ("8 GB RAM, 128 GB")
    isbn = (mtAlnum(mpn).match(/^(97[89]\d{10}|\d{9}[\dx])$/) || [])[0] || "", book = !!isbn || /\b(paperback|hardcover|hardback)\b/.test(text), by = (String(title).match(/\bby\s+([A-Za-z][\w.' -]{2,40}?)\s*(?:[(,|;]|$)/) || [])[1] || brand || "", inch = (text.match(/(\d+(?:\.\d+)?)inch/) || [])[1], pack = (text.match(/pack(\d+)/) || [])[1] || "1";
  const cap = mtSet(all.slice(0, 40), /^\d+(\.\d+)?(ml|g)$/), extra = { gen: mtSet(all, /^gen\d+$/), ton: mtSet(all, /^\d+(\.\d+)?ton$/), mah: mtSet(all.slice(0, 40), /^\d+mah$/), mm: mtSet(all.slice(0, 40), /^\d+(\.\d+)?mm$/), star: mtSet(all.slice(0, 40), /^\d+star$/), size: mtSet(all.slice(-8), /^(xs|s|m|l|xl|xxl|xxxl)$/), w: mtSet(head, /^\d+(\.\d+)?w$/), v: mtSet(head, /^\d+(\.\d+)?v$/), hz: mtSet(all.slice(0, 40), /^\d+hz$/), len: mtSet(all.slice(0, 40), /^\d+(\.\d+)?m$/), colour: mtSet(all.slice(0, 40), { test: x => MT_COLOURS.has(x) }), temp: mtSet(all.slice(0, 40), /^(warm|cool|daylight|neutral)$/), kind: mtSet(mtWords(String(title).replace(/t-?shirts?|tees?\b/gi, "tshirt")).slice(0, 9).map(x => x.replace(/([^s])s$/, "$1").replace(/^sneaker$/, "shoe")), /^(shirt|tshirt|polo|jean|trouser|pant|chino|short|dress|kurta|kurti|hoodie|sweatshirt|jacket|vest|brief|boxer|saree|sandal|slipper|boot|loafer|sock|shoe)$/), gender: new Set([...mtSet(all.slice(0, 40), /^(men|mens|women|womens|boys|girls|kids|unisex)$/)].map(g => g.replace(/s$/, ""))) };
  const raw160 = text.slice(0, 200), kit = /\b(kit lens|lens kit|with \d{2}-?\d{0,3}\s?mm lens|\d{2}-\d{2,3}mm lens)\b/.test(raw160), body = /\b(body only|body without|camera body|without lens)\b/.test(raw160);
  return { cnt, fmt: (text.match(/\b(paperback|hardcover|hardback)\b/) || [])[1] || "", book, isbn, bookTitle: book ? mtAlnum(String(title).split(/[:(|;]|\sby\s|\s[-–—]\s/i)[0]) : "", authors: book ? by.toLowerCase().split(/[^a-z]+/).filter(x => x.length > 1) : [], rom: sg.length ? sg[sg.length - 1] : 0, ram: sg.slice(0, -1).filter(v => v <= 24), mpn: mtCode(mpn) ? mtAlnum(mpn) : "", brand: b, model, lead, series, variants: new Set(head.filter((w, i) => MT_VARIANT.has(w) && !(w === "ultra" && head[i + 1] === "hd") && !(w === "air" && /^(fryer|purifier|conditioner|cooler|bud|buds|pods|fryers)$/.test(head[i + 1] || "")) && (!model.length || model.some(m => { const k = head.indexOf(m), fit = MT_FIT.has(w); return k >= 0 && i >= k - 1 && i <= k + (fit ? 5 : 2); })))), storage, inch: inch ? +inch : null, cap, extra, kit, body, bad: MT_REJECT.test(raw160) ? (raw160.match(MT_REJECT) || [])[1] || "x" : "", pack, fam: new Set(fam), codes: new Set(codes), tokens: tag, head,
    bundle: /\s\+\s/.test(String(title || "").slice(0, 160)), lang: (text.match(/\b(hindi|marathi|tamil|telugu|bengali|gujarati|kannada|malayalam|punjabi|panjabi|assamese|odia|oriya|nepali|sanskrit|urdu|spanish|french|german|italian|portuguese|russian|japanese|chinese|korean|arabic)\b/) || [])[1] || "" };
}
const mtHas = (cand, b) => { if (!b) return true; const t = mtAlnum(cand.title); return t.includes(b) || mtAlnum(cand.brand).includes(b) || (MT_ALIAS[b] || []).some(a => t.includes(a)); };
// Books: ISBN in the listing = exact; else the main title AND the author (any word order) = likely.
function mtBook(src, cand) {
  const t = mtAlnum(cand.title), c = mtFacts(cand.title, ""), no = k => ({ verdict: null, why: [], conflicts: [k] });
  if (src.isbn && t.includes(src.isbn)) return { verdict: "exact", why: ["isbn"], conflicts: [], mpnHit: true };
  if (src.bookTitle.length < 6 || !t.includes(src.bookTitle)) return no("title");
  if (!src.authors.length || !src.authors.every(w => t.includes(w))) return no("author");
  if (c.lang !== src.lang) return no("language"); if (c.fmt && src.fmt && c.fmt !== src.fmt) return no("format");
  return { verdict: "likely", why: ["title and author"], conflicts: [] };
}
// verdict: "exact" (brand + model + every spec we know agree), "likely" (no conflict, some spec the listing does not state), null (anything else)
function mtCompare(src, cand) {
  const c = mtFacts(cand.title, src.brand || cand.brand), why = []; let conflicts = [];
  if (src.book && MT_BOOK_OTHER.test(mtNorm(cand.title)) && !MT_BOOK_OTHER.test(src.head.join(" "))) return { verdict: null, why: [], conflicts: ["other edition"] };
  if (src.book && !(src.brand && mtHas(cand, src.brand))) return mtBook(src, cand); // a book's "brand" is its author: the shop's title may only carry it reversed ("Clear James")
  if (!src.brand) return { verdict: null, why: ["page brand unknown"], conflicts: [] };
  if (!mtHas(cand, src.brand)) return { verdict: null, why: [], conflicts: ["brand"] };
  // model numbers: every identifying token on the page must appear in the listing, and the listing's own must not differ by a digit/letter
  const ctoks = new Set(c.head.concat(mtWords(cand.title).slice(0, 80)));
  const suffixOk = m => [...ctoks].some(x => x.startsWith(m) && x.length - m.length >= 2 && x.length - m.length <= 3 && /\d/.test(x.slice(m.length)) && /[a-z]/.test(m)); // WW80T4040 -> WW80T4040CE1 (market/colour suffix); NA120 -> NA1200 stays different
  const missing = src.model.filter(m => !ctoks.has(m) && !suffixOk(m)); if (missing.length) conflicts.push("model " + missing.join("/"));
  for (const m of src.model) for (const x of c.model) if (m !== x && (mtEd1(m, x) || (/^\d+$/.test(m) && /^\d+/.test(x) && x.startsWith(m)) || (/^\d+$/.test(x) && /^\d+/.test(m) && m.startsWith(x)))) conflicts.push(`model ${m} vs ${x}`);
  if (src.lead && !ctoks.has(src.lead)) conflicts.push("name " + src.lead); // the product line word (revolution, galaxy, airdopes) must appear
  let loose = false; // ponytail: no model number -> order-insensitive token containment, never better than Likely; misses a re-worded listing rather than risk a wrong one
  if (!src.model.length) { const a = new Set(src.series), bb = new Set(c.series), inter = [...a].filter(x => bb.has(x)).length, uni = new Set([...a, ...bb]).size;
    if (a.size && inter / uni >= 0.75) { /* same words in the same place */ } else if (a.size >= 2 && [...a].every(x => ctoks.has(x)) && [...bb].filter(x => !src.tokens.has(x)).length <= 2) loose = true; else conflicts.push("name"); }
  if ([...src.variants].sort().join() !== [...c.variants].sort().join()) conflicts.push("version");
  if (src.rom && c.rom && (src.rom !== c.rom || (src.ram.length && c.ram.length && !src.ram.some(x => c.ram.includes(x))))) conflicts.push("storage"); // the listing may add or drop the RAM figure ("8 GB RAM"), but a different RAM or ROM is another variant
  if (src.inch && c.inch && Math.abs(src.inch - c.inch) > 1) conflicts.push("screen size");
  if (src.cap.size && c.cap.size && ![...src.cap].some(x => c.cap.has(x))) conflicts.push("capacity");
  if (src.pack !== c.pack) conflicts.push("pack size");
  if (src.fam.size && c.fam.size && ![...src.fam].some(x => c.fam.has(x))) conflicts.push("processor");
  if (src.codes.size && c.codes.size && ![...src.codes].some(x => c.codes.has(x))) conflicts.push("processor model");
  for (const k in src.cnt) if (c.cnt[k] != null && c.cnt[k] !== src.cnt[k]) conflicts.push(k + " count");
  if (c.lang && c.lang !== src.lang) conflicts.push("language");
  if (c.bundle && !src.bundle) conflicts.push("bundle");
  if (c.bad && !src.bad) conflicts.push("accessory or used (" + c.bad + ")");
  { const ct = mtNorm(cand.title), m2 = ct.match(/\b(?:for|compatible with|fits|suitable for|designed for)\s+((?:[a-z0-9+]+(?:\s+|$)){0,3})/); if (m2 && !mtNorm((src.head || []).join(" ")).includes(" for ") && [src.brand, src.lead, ...src.model].filter(Boolean).some(x => mtAlnum(m2[1]).includes(x))) conflicts.push("accessory (for " + m2[1].trim() + ")"); }
  for (const k of ["gen", "ton", "mah", "mm", "star", "size", "gender", "w", "v", "hz", "len", "temp", "kind"]) { const a = src.extra[k], b2 = c.extra[k]; if (a.size && b2.size && ![...a].some(x => b2.has(x))) conflicts.push(k === "mm" ? "case size" : k === "w" ? "power" : k === "len" ? "length" : k === "temp" ? "light colour" : k === "kind" ? "product type" : k); }
  if ((src.kit || c.kit || src.body || c.body) && (src.kit !== c.kit || src.body !== c.body)) conflicts.push("kit / body only");
  const mpnHit = !!src.mpn && mtAlnum(cand.title).includes(src.mpn); // the page's own model number is in the listing (anywhere in it): the strongest evidence we can read. Only "is it the thing itself" checks still apply
  if (mpnHit) conflicts = conflicts.filter(k => /^(storage|pack|language|bundle|accessory|kit)/.test(k));
  if (conflicts.length) return { verdict: null, why, conflicts };
  if (!mpnHit && !src.model.length && src.series.length && src.series.every(x => MT_NOUN.has(x)) && !(src.extra.w.size || src.extra.mah.size || src.cap.size || src.storage.size || src.pack !== "1" || src.inch)) return { verdict: null, why, conflicts: ["generic name"] };
  if (mpnHit) return { verdict: "exact", why: ["model number"], conflicts, mpnHit: true };
  const known = [src.storage.size && !c.storage.size ? "storage" : "", src.fam.size && !c.fam.size ? "processor" : "", !!src.extra.gen.size !== !!c.extra.gen.size ? "generation" : "", src.extra.kind.size && src.extra.colour.size && c.extra.colour.size && ![...src.extra.colour].some(x => c.extra.colour.has(x)) ? "colour" : "", !src.model.length && c.model.some(m => m.length >= 2 && !/^gen\d+$/.test(m)) ? "model" : "", !src.model.length && ["w", "v", "hz", "len", "mah"].some(k => !!src.extra[k].size !== !!c.extra[k].size) ? "power or capacity" : ""].filter(Boolean); // screen size / capacity are implied by the model, storage, CPU and generation are not
  const v = src.model.length || src.series.length >= 2 || (src.series.length >= 1 && (src.cap.size || src.pack !== "1" || src.storage.size)) ? (known.length || loose || (!src.model.length && !(src.cap.size || src.storage.size || src.pack !== "1" || src.extra.w.size || src.extra.mah.size || src.inch || src.book || src.extra.gen.size)) ? "likely" : "exact") : null;
  return { verdict: v, why: known.map(k => k + " not stated"), conflicts };
}

// The one search query for a product, used by the compare fetch and the quick links so both look for the same thing: brand, the head of the title up to the model number
// (plus a variant word after it), the biggest storage figure. Title order, no marketing words, no duplicated brand ("Fire-Boltt Fire Boltt").
function mtQuery(title, brand, mpn) {
  const f = mtFacts(title, brand, mpn), by = String(brand || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]+/g, " ").trim() || f.authors.join(" ");
  let w = f.head.slice(), j = ""; while (w.length && f.brand && j.length < f.brand.length && f.brand.startsWith(j + mtAlnum(w[0]))) j += mtAlnum(w.shift());
  if (w.includes("by")) w = w.slice(0, w.indexOf("by"));
  w = w.filter(x => (x.length > 1 || /\d/.test(x)) && !MT_GENERIC.has(x) && (!MT_SPEC.test(x) || /^\d+(\.\d+)?(w|mah)$/.test(x)));
  const mi = w.findIndex(x => f.model.includes(x)), code = f.model.find(x => !f.head.includes(x));
  if (!w.length && !code) w = mtWords(title).filter(x => x.length > 1 && !MT_GENERIC.has(x) && !MT_SPEC.test(x) && !by.split(" ").includes(x)).slice(0, 4); // the title opens with a size and has no model code: take the first plain words
  if (mi >= 0) { let e = mi + 1; while (e < w.length && (MT_VARIANT.has(w[e]) || /^gen\d+$/.test(w[e]))) e++; w = w.slice(0, e); } else w = w.slice(0, 4);
  if (code && (mi < 0 || /^\d{1,3}$|^\d[a-z]$/.test(w[mi])) && !w.includes(code)) w.push(code); // "HP Laptop 15" is too generic on its own: add the model code from the title
  const st = f.rom ? (f.rom >= 1024 && f.rom % 1024 === 0 ? f.rom / 1024 + "tb" : f.rom + "gb") : "";
  return [by, ...w, st].filter(Boolean).join(" ");
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
if (typeof module !== "undefined") module.exports = { mtQuery, mtChecks, mtFacts, mtCompare, mtNorm, mtWords, mtHead };
