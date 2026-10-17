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
assert.equal(wrongExact, 0, `${wrongExact} gold pair(s) wrong`);
console.log(`match: ${n} passed, 0 failed`);
