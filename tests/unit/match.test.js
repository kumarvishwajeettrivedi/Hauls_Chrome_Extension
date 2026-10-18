// Gold set for the product matcher, built from titles seen in the live compare evaluation (tests/e2e/compare-eval.mjs).
// "exact"/"likely" must be the SAME product; null must be a different one. A wrong exact is the failure we cannot afford.
const assert = require("assert"), M = require("../../extension/match.js");
let n = 0, wrongExact = 0;
const T = (src, brand, cand, want, why, cb) => { const got = M.mtCompare(M.mtFacts(src, brand), { title: cand, brand: cb }); if (got.verdict !== want) { console.log(`MISMATCH want=${want} got=${got.verdict} [${got.conflicts}] ${why}\n   SRC ${src.slice(0, 70)}\n   CND ${cand.slice(0, 70)}`); wrongExact++; } else n++; };
// phones
T("iPhone 16 128 GB: 5G Mobile Phone with Camera Control, A18 Chip", "Apple", "Apple iPhone 16 128 GB, Ultramarine", "exact", "same phone");
T("iPhone 16 128 GB: 5G Mobile Phone with Camera Control, A18 Chip", "Apple", "Apple iPhone 16e (Black, 128 GB)", null, "16e is a different model");
T("iPhone 16 128 GB: 5G Mobile Phone with Camera Control, A18 Chip", "Apple", "Apple iPhone 16 Plus (128 GB)", null, "Plus");
T("iPhone 16 128 GB: 5G Mobile Phone with Camera Control, A18 Chip", "Apple", "Apple iPhone 16 (256 GB) Black", null, "storage");
T("Apple iPhone 17e 256 GB: 15.40 cm (6.1″) Super Retina XDR Display, A19 Chip", "Apple", "Apple iPhone 17e (White, 256 GB)", "exact", "17e 256");
T("Apple iPhone 17e 256 GB: 15.40 cm (6.1″) Super Retina XDR Display, A19 Chip", "Apple", "Apple iPhone 17e (Soft Pink, 512 GB)", null, "17e 512");
T("Apple iPhone 17e 256 GB: 15.40 cm (6.1″) Super Retina XDR Display, A19 Chip", "Apple", "Apple iPhone 17 (Black, 256 GB)", null, "17 vs 17e");
T("Galaxy S24 5G AI Smartphone (Amber Yellow, 8GB, 128GB Storage)", "Samsung", "Samsung Galaxy S24 5G Snapdragon (Amber Yellow, 128 GB) 8 GB RAM", "exact", "s24");
T("Galaxy S24 5G AI Smartphone (Amber Yellow, 8GB, 128GB Storage)", "Samsung", "Samsung Galaxy S26 FE 5G 256 GB, 8 GB RAM with Galaxy AI", null, "s26 fe");
T("N6 | 6GB+128GB | Midnight Green | Segment's Biggest 8000mAh Battery", "OnePlus", "OnePlus N6 5G 128 GB, 6 GB RAM, Smartphone, Midnight Green", "exact", "n6");
T("N6 | 6GB+128GB | Midnight Green | Segment's Biggest 8000mAh Battery", "OnePlus", "OnePlus N6 5G (Fresh Mint, 128 GB) 6 GB RAM", "exact", "n6 other colour");
T("N6 | 6GB+128GB | Midnight Green", "OnePlus", "Samsung Galaxy N6 128 GB", null, "other brand");
// audio
T("Airdopes 141 Gen 2, 4 Mics ENx Tech, 48 Hrs Playback, Fast Charge, Low Latency, IPX4, v5.4 Bluetooth Earbuds", "boAt", "boAt Airdopes 141 Gen 2, 4 Mics ENx Tech,48H Battery,ASAP Charge,Low Latency,BT v5.4", "exact", "same");
T("Airdopes 141 Gen 2, 4 Mics ENx Tech, 48 Hrs Playback, Fast Charge, Low Latency, IPX4, v5.4 Bluetooth Earbuds", "boAt", "boAt Airdopes 148 Gen 2 with 48 Hours Playback, 10 mm Drivers", null, "148 vs 141");
T("Airdopes 141 Gen 2, 4 Mics ENx Tech, 48 Hrs Playback", "boAt", "boAt Airdopes 141 ANC TWS in Ear Earbuds with 32 dB ANC", null, "ANC variant");
T("WH-1000XM5 Best Active Noise Cancelling Wireless Bluetooth Over Ear Headphones", "Sony", "SONY WH-1000XM5 Wireless Noise Cancellation with AI Noise Reduction Bluetooth", "exact", "xm5");
T("WH-1000XM5 Best Active Noise Cancelling Wireless Bluetooth Over Ear Headphones", "Sony", "Sony WH-1000XM4 Wireless Headphones", null, "xm4");
T("WH-1000XM5 Best Active Noise Cancelling Wireless Bluetooth Over Ear Headphones", "Sony", "SONY WF-1000XM5 Noise Cancellation Earbuds with High-Res Audio TWS", null, "WF (earbuds) is not WH (headphones)");
T("Mens Revolution 8 Running Shoes", "Nike", "NIKE RUN DEFY Running Shoes For Men Black , 8", null, "different line, trailing shoe size 8");
T("Flip 6 Wireless Portable Bluetooth Speaker Pro Sound, Upto 12 Hours Playtime", "JBL", "JBL Flip 6 with 12Hr Playtime, Customize Audio by App, IP67 Rating, Portable Speaker", "exact", "pro in marketing copy is not a variant");
T("Flip 6 Wireless Portable Bluetooth Speaker", "JBL", "JBL Flip 6 Pro Wireless Speaker", null, "pro next to the model is");
// laptops / TV
T("15, AMD Ryzen 5 7520U (16GB DDR4, 512GB SSD) FHD, Anti-Glare, 15.6''/39.6cm, Win11", "HP", "Samsung Galaxy Book4 Metal Intel Core i5 13th Gen 1335U - (16 GB/512 GB SSD/Windows 11)", null, "other brand");
T("15, AMD Ryzen 5 7520U (16GB DDR4, 512GB SSD) FHD, Anti-Glare, 15.6''/39.6cm, Win11", "HP", "HP 15 15-FC1045AU Standard Laptop (AMD Ryzen 7 7735HS/16 GB/512 GB SSD/AMD Radeon)", null, "ryzen 5 vs 7");
T("IdeaPad Slim 3 Smartchoice (2026) Intel Core 3 304 AI PC (8GB RAM/512GB SSD/15.3\")", "Lenovo", "Lenovo IdeaPad Slim 3 Intel Intel Celeron Dual Core N4020 - (8 GB/256 GB SSD/Windows 11)", null, "celeron + storage");
T("IdeaPad Slim 3 Smartchoice (2026) Intel Core 3 304 AI PC (8GB RAM/512GB SSD/15.3\")", "Lenovo", "Lenovo Ideapad Slim 3 Laptop (Intel Core i3 -1215U, 8 GB / 512 GB / 3.3GHz)", null, "core 3 vs core i3");
T("55 inch (138cm) Crystal UHD 4K Vision AI 2026 Smart TV | 30W Speakers", "Samsung", "TCL T6D 139.7 cm (55 inch) QLED Google TV, 55T6D, Black", null, "other brand");
T("55 inch (138cm) Crystal UHD 4K Smart TV UA55DUE77AAKXXL", "Samsung", "Samsung 55 inch (138 cm) Crystal 4K UHD Smart TV UA55DUE77AAKXXL", "exact", "tv model code");
T("43 inch (108 cm) Crystal 4K Smart TV UA43DUE77AAKXXL", "Samsung", "Samsung 55 inch (138 cm) Crystal 4K UHD Smart TV UA55DUE77AAKXXL", null, "size");
// home / fashion / books
T("PHILIPS Air Fryer NA120/00, 4.2 Litre, Large, 100% Food Safe", "Philips", "PHILIPS NA120/00 AIR FRYER 90% less fat,1500W,4.2 Liter, Rapid Air Technology", "exact", "na120");
T("PHILIPS Air Fryer NA120/00, 4.2 Litre, Large, 100% Food Safe", "Philips", "Philips 4.2 L Air Fryer 1500 W, NA120/00", "exact", "na120 b");
T("5 Litre Hard Anodised Nakshatra Plus Svachh Innerlid Pressure Cooker", "Prestige", "Prestige Svachh Nakshatra Plus 3 L Inner Lid Induction Bottom Pressure Cooker", null, "capacity 3 vs 5");
T("Mens Revolution 8 Running Shoes", "Nike", "NIKE Revolution 7 Running Shoes For Men Blue, 8", null, "7 vs 8 (the trailing 8 is the shoe size)");
T("Men's 511 Mid Indigo Slim Fit Mid Rise Jeans", "Levi's", "LEVI'S 511 Slim Men Blue Jeans", "exact", "same cut, colour differs");
T("Men's 511 Mid Indigo Slim Fit Mid Rise Jeans", "Levi's", "LEVI'S 511 Regular Fit Men Blue Jeans", null, "slim vs regular");
T("Men's 511 Mid Indigo Slim Fit Mid Rise Jeans", "Levi's", "Philips Body and Intimate Grooming Men's Shaver, Mid-Grey, BG3470/15", null, "unrelated");
T("Atomic Habits: Tiny Changes, Remarkable Results", "James Clear", "Atomic Habits: Chote Badlav, Asadharan Parinaam (Hindi) + Apne Har Vichaar Par Niyantran", null, "hindi + bundle");
T("Liquid Handwash Bottle - Original Hand Wash- 900ml (Pack of 6) | Germ Defence", "Dettol", "CENTELLA Liquid handwash |99.9% Germ Protection|Paraben Free", null, "other brand");
T("Liquid Handwash Bottle - Original Hand Wash- 900ml (Pack of 6)", "Dettol", "Dettol Original Liquid Handwash Refill 900 ml", null, "pack size (6 vs 1)");
T("PHILIPS Air Fryer NA120/00, 4.2 Litre (Pack of 2)", "Philips", "Philips 4.2 L Air Fryer NA120/00", null, "pack of 2 vs single");
T("Penguin Atomic Habits Paperback", "Penguin", "Penguin Atomic Habits Paperback (Hindi)", null, "language differs");
T("Penguin Atomic Habits Paperback", "Penguin", "Penguin Atomic Habits Paperback", "exact", "same book");
// no brand on the page: never exact
T("Airdopes 141 Gen 2", "", "boAt Airdopes 141 Gen 2", null, "brand unknown: refuse rather than guess");
// ---- reviewer round 2: accessories, used goods, region/carrier, hardware variants (all must be null), and legit matches we must not lose
const P16 = "iPhone 16 128 GB: 5G Mobile Phone";
T(P16, "Apple", "Apple iPhone 16 Case Cover for iPhone 16 Silicone Back Cover", null, "case");
T(P16, "Apple", "Tempered Glass for Apple iPhone 16 Screen Protector", null, "screen guard");
T(P16, "Apple", "Apple iPhone 16 (128 GB) - Refurbished", null, "refurbished");
T(P16, "Apple", "Renewed Apple iPhone 16 (128 GB)", null, "renewed");
T(P16, "Apple", "Magnetic Car Mount Holder for Apple iPhone 16 128 GB", null, "mount: only the for-phrase says accessory");
T(P16, "Apple", "Apple iPhone 16 (128 GB) Used - Good", null, "used");
T(P16, "Apple", "Apple iPhone 16 128 GB Dual eSIM Hong Kong Version", null, "region");
T("Apple iPhone 15 128GB", "Apple", "Apple iPhone 15 128GB Verizon Locked", null, "carrier");
T("Samsung Galaxy S24 5G 128GB", "Samsung", "Samsung Galaxy S24 5G Back Cover Case for Galaxy S24", null, "case with brand");
T("Samsung Galaxy S24 5G 128GB", "Samsung", "Samsung Galaxy S24 5G 128GB Charger Combo", null, "combo");
T("Sony PlayStation 5 Slim Console", "Sony", "Sony PlayStation 5 Slim Console Cover Faceplate", null, "faceplate");
T("Philips Air Fryer HD9252/90 4.1L", "Philips", "Philips Air Fryer HD9252/90 Spare Basket", null, "spare");
T("Redmi Note 13 Pro 5G (8GB, 256GB)", "Xiaomi", "Xiaomi Redmi Note 13 Pro+ 5G (8GB, 256GB)", null, "Pro vs Pro+");
T("Samsung Galaxy S24 5G", "Samsung", "Samsung Galaxy S24+ 5G", null, "S24 vs S24+");
T("Samsung Galaxy S24+ 5G", "Samsung", "Samsung Galaxy S24 5G", null, "S24+ vs S24");
T("Apple Watch Series 9 GPS 45mm", "Apple", "Apple Watch Series 9 GPS 41mm", null, "case size");
T("Apple Watch Series 9 GPS 45mm", "Apple", "Apple Watch Series 9 GPS + Cellular 45mm", null, "cellular");
T("Sony PS5 Console Slim Digital Edition", "Sony", "Sony PS5 Console Slim Disc Edition", null, "digital vs disc");
T("Canon EOS R50 Mirrorless Camera Body", "Canon", "Canon EOS R50 Mirrorless Camera with 18-45mm Lens", null, "body vs kit");
T("Canon EOS R50 Mirrorless Camera with 18-45mm Lens", "Canon", "Canon EOS R50 Mirrorless Camera Body Only", null, "kit vs body");
T("Mi Power Bank 3i 20000mAh", "Mi", "Mi Power Bank 3i 10000mAh", null, "mAh");
T("Samsung 1.5 Ton 5 Star Split AC", "Samsung", "Samsung 1.0 Ton 5 Star Split AC", null, "ton");
T("Nike Air Max 270 Men's Running Shoes", "Nike", "Nike Air Max 270 Women's Running Shoes", null, "gender");
T("Levi's Men's 511 Slim Fit Jeans Blue L", "Levi's", "Levi's Men's 511 Slim Fit Jeans Blue XL", null, "apparel letter size");
T("Kindle Paperwhite 16 GB", "Amazon", "Kindle Paperwhite (16 GB) - 6.8 inch display", "exact", "sub-brand title");
T("Redmi Note 13 5G (8GB, 256GB)", "Xiaomi", "Redmi Note 13 5G (8GB, 256GB)", "exact", "Redmi is Xiaomi");
T("Amul Butter 500 g", "Amul", "Amul Butter 0.5 kg", "exact", "kg vs g");
T("Amul Gold Milk 1 L", "Amul", "Amul Gold Milk 1000 ml", "exact", "l vs ml");
T("Samsung 8 kg Front Load WW80T4040", "Samsung", "Samsung 8 kg Front Load WW80T4040CE1", "exact", "market suffix on the model code");
T("Philips Air Fryer NA120", "Philips", "Philips Air Fryer NA1200", null, "NA120 vs NA1200 stay different");
{ const f = M.mtFacts("Apple iPhone 17e 256 GB White", "Apple", "MHRW4HN/A"), g = c => M.mtCompare(f, { title: c });
  assert.equal(g("Apple iPhone 17e 256 GB (MHRW4HN/A)").mpnHit, true, "page model number found in the listing"); n++;
  assert.equal(g("Apple iPhone 17e 512 GB (MHRW4HN/A)").verdict, null, "a model number never overrides a spec conflict"); n++; }
// "same product" panel rows
{ const S = "Apple iPhone 17e 256 GB: 15.40 cm (6.1″) Super Retina XDR Display, White", f = M.mtFacts(S, "Apple"), rows = M.mtChecks(f, { title: "Apple iPhone 17e (Soft Pink, 256 GB)", brand: "Apple" }, S), g = k => rows.find(r => r.k === k);
  assert.ok(g("Brand").ok && g("Brand").v === "Apple" && g("Model").v === "17E" && g("Version").v === "Standard" && g("Storage").v === "256GB" && g("Storage").ok === true, "rows agree: " + JSON.stringify(rows)); n++;
  assert.ok(g("Colour") && g("Colour").ok === false && g("Colour").info, "different colour is shown as info, not a mismatch"); n++;
  const r2 = M.mtChecks(f, { title: "Apple iPhone 17e", brand: "Apple" }, S); assert.equal(r2.find(r => r.k === "Storage").ok, null, "storage not stated by the listing"); n++; }
// ---- compare audit (2026-10-18). Titles are real listings from that run; "[abbreviated]" / "[synthetic]" mark the ones that are not verbatim. ----
{ const LG = "LG 108 cm (43 inches) 4K Ultra HD Smart LED TV 43UR7500PSC (Black)", FKLG = "LG UR7500 108 cm (43 inch) 4K Ultra HD LED Smart TV with ThinQ AI Alexa Built-in Dolby Atmos Active HDR 10 Pro Magic remote supported 5-Year Guaranteed Warranty with New OS Experience Free Wall mount service 43UR7500PSC [abbreviated]";
  const f = M.mtFacts(LG, "LG", "43UR7500PSC"), g = c => M.mtCompare(f, { title: c, brand: "LG" });
  assert.equal(g(FKLG).verdict, "exact", "model number after the 30th word still matches"); n++; assert.equal(g(FKLG).mpnHit, true); n++;
  assert.equal(g("Remote Control Cover for LG 43UR7500PSC TV").verdict, null, "an accessory carrying the model number is still rejected"); n++;
  assert.equal(g("Wall Mount Bracket Stand for LG 43UR7500PSC 43 inch TV [synthetic]").verdict, null, "so is a 'for LG ...' mount"); n++;
  assert.equal(g("LG UR7500 108 cm (43 inch) 4K Smart TV 43UR7500PSC Renewed [synthetic]").verdict, null, "and a renewed one"); n++;
  assert.equal(M.mtCompare(M.mtFacts("Apple iPhone 17e 256 GB White", "Apple", "MHRW4HN/A"), { title: "Apple iPhone 17e 512 GB (MHRW4HN/A) [synthetic]" }).verdict, null, "model number never overrides a storage conflict"); n++; }
// litres: a model code ending in L is not a volume
assert.ok(!/000ml/.test(M.mtNorm("Sony KD-55X75L")) && !/000ml/.test(M.mtNorm("Vivo Y200L")) && /1500ml/.test(M.mtNorm("Philips 1.5L Airfryer")) && /5000ml/.test(M.mtNorm("Prestige 5 Litre")) && /1000ml/.test(M.mtNorm("Amul 1 L")), "litre regex leaves model codes alone"); n++;
T("Sony Bravia KD-55X75L 55 inch 4K TV [synthetic]", "Sony", "Sony Bravia 55 inch KD-55X75K 4K Google TV [synthetic]", null, "75L vs 75K");
T("Sony Bravia KD-55X75L 55 inch 4K TV [synthetic]", "Sony", "Sony BRAVIA KD-55X75L 55 inch 4K Google TV [synthetic]", "exact", "75L vs 75L");
// generation
T("Apple AirPods Pro (2nd Generation) with MagSafe Case (USB-C)", "Apple", "Apple AirPods Pro (1st Generation) with MagSafe Charging Case", null, "1st vs 2nd generation");
T("Apple AirPods Pro (2nd Generation) with MagSafe Case (USB-C)", "Apple", "Apple AirPods Pro 2nd Gen (USB-C) with MagSafe Case", "exact", "2nd generation = 2nd gen");
T("Apple AirPods Pro (2nd Generation) with MagSafe Case (USB-C)", "Apple", "Apple AirPods Pro (USB-C) with MagSafe Case", "likely", "listing does not say the generation: likely");
T("Airdopes 141, Up to 50 Hours Playtime, Quad Mics ENx Tech, BT v5.3, IPX4 TWS Earbuds (Matte Charcoal)", "boAt", "boAt Airdopes 141 Gen 2, 4 Mics ENx Tech,48H Battery,ASAP Charge,Low Latency,BT v5.4 Bluetooth", "likely", "a Gen 2 listing for a page without a gen is not confirmed");
T("HP Laptop 15, 13th Gen Intel Core i5-1335U (16GB DDR4, 512GB SSD) 15.6-inch, FHD, Win 11", "HP", "HP 15 Intel Core i5 12th Gen 1235U (16 GB/512 GB SSD/Windows 11 Home) 15-fd0xxx [abbreviated]", null, "13th vs 12th gen");
// storage: the listing may add the RAM figure, never change RAM or ROM
T("Samsung Galaxy M35 5G 128GB", "Samsung", "Samsung Galaxy M35 5G (Thunder Grey, 128 GB) 8 GB RAM", "exact", "RAM only on the listing");
T("OnePlus 12R 256GB Cool Blue", "OnePlus", "OnePlus 12R (Cool Blue, 256 GB) 16 GB RAM", "exact", "RAM only on the listing (OnePlus)");
T("Samsung Galaxy M35 5G (Moonlight Blue, 8GB RAM, 128GB Storage)", "Samsung", "Samsung Galaxy M35 5G (Thunder Grey, 128 GB) 8 GB RAM", "exact", "same RAM and ROM");
T("Samsung Galaxy M35 5G (Moonlight Blue, 8GB RAM, 128GB Storage)", "Samsung", "Samsung Galaxy M35 5G (Thunder Grey, 128 GB) 6 GB RAM", null, "6 GB RAM variant");
T("Samsung Galaxy M35 5G (Moonlight Blue, 8GB RAM, 128GB Storage)", "Samsung", "Samsung Galaxy M35 5G (Thunder Grey, 256 GB) 8 GB RAM", null, "256 GB variant");
T("Apple MacBook Air 13 inch M3 (8GB, 256GB SSD) [synthetic]", "Apple", "Apple MacBook Air 13 inch M3 (1 TB SSD, 8GB) [synthetic]", null, "TB vs GB");
// compound words
T("Philips Air Fryer HD9200/90, uses up to 90% less fat, 1400W, 4.1 Liter, Rapid Air Technology (Black), Large", "Philips", "Philips Essential Spectre 4.1L Airfryer with Healthy Frying with Rapid Air technology (HD9200)", "exact", "Air Fryer = Airfryer");
T("Philips Air Fryer HD9200/90, 4.1 Liter", "Philips", "Philips Air Fryer HD9252/90 4.1 L", null, "other Philips fryer");
T("Boult Power Bank 10000mAh [synthetic]", "Boult", "Boult Powerbank 10000mAh [synthetic]", "exact", "Power Bank = Powerbank");
// "90% less fat" is marketing copy, not a model number
T("PHILIPS HD9200/90 uses up to 90% less fat 1400W, with Rapid Air Technology Air Fryer 4.1 L", "PHILIPS", "Philips Essential Spectre 4.1L Airfryer with Healthy Frying with Rapid Air technology (HD9200), Black [abbreviated]", "exact", "90% is not a model");
T("PHILIPS HD9200/90 uses up to 90% less fat 1400W, with Rapid Air Technology Air Fryer 4.1 L", "PHILIPS", "Air Fryer HD9200/90, uses up to 90% less fat, 1400W, 4.1 Liter, with Rapid Air Technology (Black), Large (Pack of 2)", null, "pack of 2");
// no model number: order-insensitive containment, never better than Likely, a different line is rejected
T("Prestige Svachh Deluxe Alpha Stainless Steel Pressure Cooker, 5 Litre, Silver", "Prestige", "Prestige Svachh Deluxe Alpha 5 L Outer Lid Induction Bottom Pressure Cooker Stainless Steel", "likely", "same line, listing re-worded");
T("Prestige Svachh Deluxe Alpha Stainless Steel Pressure Cooker, 5 Litre, Silver", "Prestige", "Prestige Popular Steel Svachh 5 L Outer Lid Pressure Cooker [abbreviated]", null, "other Prestige line");
T("Prestige Svachh Deluxe Alpha Stainless Steel Pressure Cooker, 5 Litre, Silver", "Prestige", "TTK Prestige Marvel GTM 04 Cooktop Hob", null, "cooktop");
T("Prestige Svachh Deluxe Alpha Stainless Steel Pressure Cooker, 5 Litre, Silver", "Prestige", "Prestige Svachh Deluxe Alpha 3 L Outer Lid Pressure Cooker Stainless Steel [synthetic]", null, "3 L vs 5 L");
T("Wakefit Eco TV Unit | Engineered Wood TV Stand for Living Room, Walnut Finish", "Wakefit", "Wakefit Fabric 3 Seater Sofa [abbreviated]", null, "sofa for a TV unit");
// books: ISBN, else main title + author in any order; nothing from a summary / other language / other binding
{ const AH = "Atomic Habits: The life-changing million copy bestseller by James Clear (Paperback)", f = M.mtFacts(AH, "James Clear", "9781847941831"), g = c => M.mtCompare(f, { title: c, brand: "" });
  assert.equal(g("Atomic Habits: An Easy & Proven Way to Build Good Habits & Break Bad Ones (English, Paperback, Clear James)").verdict, "likely", "title + author, author reversed"); n++;
  assert.equal(g("Atomic Habits (English, Paperback, Clear James) 9781847941831 [synthetic]").verdict, "exact", "ISBN in the listing"); n++;
  assert.equal(g("Atomic Habits (Hindi, Paperback, Clear James)").verdict, null, "other language"); n++;
  assert.equal(g("Atomic Habits (English, Hardcover, Clear James)").verdict, null, "other binding"); n++;
  assert.equal(g("Summary of Atomic Habits by James Clear (English, Paperback) [synthetic]").verdict, null, "a summary is another book"); n++;
  assert.equal(g("Atomic Habits (English, Paperback, Someone Else) [synthetic]").verdict, null, "other author"); n++;
  assert.equal(g("Atomic Habits Journal (English, Paperback, Clear James) [synthetic]").verdict, null, "a journal is another book"); n++;
  assert.equal(M.mtCompare(M.mtFacts("Philips Air Fryer HD9200/90", ""), { title: "Philips Air Fryer HD9200/90" }).verdict, null, "no brand and not a book: never matched"); n++; }
{ const f = M.mtFacts("Atomic Habits: The life-changing million copy bestseller by James Clear (Paperback)", "James Clear", "9781847941831");
  assert.equal(M.mtCompare(f, { title: "Atomic Habits (Assamese) Assamese, Paperback, Clear James", brand: "" }).verdict, null, "Assamese edition"); n++;
  assert.equal(M.mtCompare(f, { title: "Atomic Habits  - Tiny Changes, Remarkable Results English, Paperback, Clear James", brand: "" }).verdict, "likely", "English paperback"); n++; }
assert.equal(M.mtFacts("Atomic Habits (Paperback)", "").authors.length, 0, "a book without an author cannot be matched"); n++;
assert.equal(M.mtCompare(M.mtFacts("Atomic Habits (Paperback)", ""), { title: "Atomic Habits (English, Paperback, Clear James)" }).verdict, null, "title alone is not enough"); n++;
assert.equal(wrongExact, 0, `${wrongExact} gold pair(s) wrong`);
console.log(`match: ${n} passed, 0 failed`);
