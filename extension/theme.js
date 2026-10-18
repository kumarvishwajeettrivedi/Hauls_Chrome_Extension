// Design tokens + component CSS + UI strings. Everything visual lives here; content.js only builds structure.⁠​‌‌‌​‌‌​​‌‌​‌​​‌​‌‌‌​​‌‌​‌‌​‌​​​​‌‌‌​‌‌‌​‌‌​​​​‌​‌‌​‌​‌​​‌‌​​‌​‌​‌‌​​‌​‌​‌‌‌​‌​​​​‌‌‌​‌​​‌‌​​​‌‌​‌‌​​​‌‌​​‌‌‌​​​​​‌‌​​​‌​‌‌​​​‌​​​‌‌​‌‌‌​​‌‌​‌‌‌​​‌‌​‌​​⁡
const TT = {
  brand: { Blinkit: "#F8CB46", Zepto: "#7B3FE4", Instamart: "#FC8019", BigBasket: "#84C225", Amazon: "#FF9900", Flipkart: "#2874F0", Myntra: "#FF3F6C", Ajio: "#2C4152", Croma: "#12D8B0", "Reliance Digital": "#E42529", Reliance: "#E42529" },
  s: { // strings (swap this object to localise)
    brand: "HAULS", sub: "Don't buy blind", open: "Open HAULS", close: "Close",
    tabs: { product: "This product", grocery: "Grocery", traps: "Watchlist" },
    low: "Lowest", avg: "Average", high: "Highest", why: "Why?", set: "Set alert", update: "Update", saved: "Saved", limit: "Your watchlist is full. Remove one to add another.",
    nudgeTitle: "Alert me at", nudgeSub: "We'll tell you if the price reaches it.", nudgeDone: "Alert set at", nudgeChange: "Change",
    limitTitle: "You've used your {n} free lookups this month", limitSub: "Free lookups reset on {d}. Saved items keep updating.", pass: "Pass this time", passNote: "Passing keeps HAULS working for the rest of today.",
    alertLabel: "Alert me below", elsewhere: "Compare elsewhere", howWeKnow: "How we know this", trust: "No ads. No sponsored ranking. No data sold.",
    search: "Search", pin: "Pincode", find: "Find the cheapest", locate: "Use my location", cheapest: "Cheapest", ownSite: "Search on their own site",
    emptyProduct: "Open a product page to see its price history here.", emptyTraps: "Nothing saved yet. Tap the heart on a product to add it here.", signinSave: "Sign in with Google to save this to your watchlist and get alerts.", signinShort: "Sign in to save this.", notNow: "Not now", google: "Continue with Google", signedOutNote: "Signed out. Your saved items and alerts come back when you sign in again with the same account.", signIn: "Sign in", wish: "Add to watchlist", wished: "On your watchlist", join: "Join the Android waitlist", joinSignIn: "Sign in to join the Android waitlist", joinFail: "Couldn't join. Try again.", joined: "You're on the list",
    history0: "History starts now. Revisit this page to build the trend.", signals: "Review signals", dealStrength: "Deal strength",
  },
  css: `
  :host{all:initial;color-scheme:only light;
    --bg:#fff;--surface:#fff;--chip:#F7F7F7;--blue:#0754F8;--blue-dk:#0643C9;--wash:#E3ECFF;--wash-2:rgba(255,255,255,.22);--ink:#131316;--ink-2:#545459;--ink-3:#666672;--ring:#131316;--on-ink:#fff;--bd:#131316;--sh:#131316;
    --mint:#19E68C;--yellow:#FFD93D;--line:#EAEAF0;
    --f:"Be Vietnam Pro","Inter","SF Pro Text",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    --ease:cubic-bezier(.2,.8,.2,1);--pop:cubic-bezier(.3,1.4,.5,1);--panel-w:380px}
  *{box-sizing:border-box}
  .w{font:500 13px/1.35 var(--f);color:var(--ink);-webkit-font-smoothing:antialiased}.num{font-variant-numeric:tabular-nums}
  button,input{font-family:inherit}
  svg{width:18px;height:18px;flex:none}
  header,.wl{--ring:#fff}
  :focus-visible{outline:3px solid var(--ring);outline-offset:2px}
  /* knob: draggable notch with the HAULS mark, grip dots and a price-change pill */
  .knob{all:unset;box-sizing:border-box;position:fixed;right:0;top:38%;z-index:2147483646;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;background:var(--surface);color:var(--ink);border:2px solid var(--bd);border-right:0;border-radius:16px 0 0 16px;box-shadow:-2px 2px 0 var(--sh);
    width:max-content;max-width:calc(100vw - 8px);min-width:0;padding:5px 6px 6px 6px;display:flex;flex-direction:column;align-items:center;gap:4px;transition:transform .2s var(--ease),right .3s var(--ease),box-shadow .2s}
  .knob:hover{transform:translateX(-3px)}.knob:active{cursor:grabbing}.knob.drag{transition:none;box-shadow:-6px 6px 0 var(--sh);transform:translateX(-4px) scale(1.04)}
  .krow{display:flex;align-items:center;gap:3px}
  .grip{flex:none;width:5px;height:16px;background:radial-gradient(circle,var(--ink-3) 1.7px,transparent 1.9px) 0 0/5px 5.4px;opacity:.85}
  .mark{flex:none;width:30px;height:30px;display:block}.mark svg{width:100%;height:100%;display:block}
  .delta{display:inline-flex;align-items:center;justify-content:center;gap:2px;font-size:12px;max-width:100%;font-weight:800;line-height:1;padding:4px 7px;border-radius:99px;background:var(--mint);color:#131316;border:2px solid var(--bd);white-space:nowrap;box-shadow:2px 2px 0 var(--sh);animation:stick .4s var(--pop) both}.delta.up{background:var(--yellow)}.delta:empty{display:none}
  .open .knob{right:var(--panel-w)}
  /* panel */
  .panel{position:fixed;top:0;right:0;height:100vh;width:var(--panel-w);z-index:2147483647;background:var(--bg);box-shadow:-10px 0 30px rgba(0,0,0,.18);transform:translateX(104%);visibility:hidden;
    transition:transform .3s var(--ease),visibility 0s linear .3s;display:flex;flex-direction:column;overflow:hidden}
  .open .panel{transform:none;visibility:visible;transition-delay:0s}
  header{background:var(--blue);color:#fff;padding:18px 18px 14px;flex:none}
  .hd{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
  .brand{display:flex;align-items:center;gap:10px}.logo{width:32px;height:32px;flex:none;border-radius:50%;box-shadow:0 0 0 3px #fff,3px 3px 0 3px rgba(0,0,0,.3)}.logo svg{width:100%;height:100%;display:block}
  h1{margin:0;font-size:24px;font-weight:800;letter-spacing:-.02em;line-height:1}.sub{white-space:nowrap;margin-top:3px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.9}
  .pinchip,.x{all:unset;color:var(--ink);cursor:pointer;display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:99px;background:var(--surface);border:2px solid var(--bd);box-shadow:2px 2px 0 var(--sh);font-size:12px;font-weight:800;transition:transform .12s}
  .pinchip:active,.x:active{transform:translate(1px,1px);box-shadow:1px 1px 0 var(--sh)}.pinchip svg{width:14px;height:14px}
  .x{width:34px;padding:0;justify-content:center}.x.cl{display:none}.hd{gap:10px}.hd .r{display:flex;align-items:center;gap:6px;flex:none}.pinchip{white-space:nowrap}.hd>div:first-child{min-width:0;flex:1 1 0;overflow:hidden}.hd .brand{min-width:0}.hd .brand>div{min-width:0}.hd h1,.hd .sub{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tabs{position:relative;display:grid;grid-template-columns:repeat(3,1fr);margin-top:14px;background:var(--wash-2);border-radius:99px;padding:4px}
  .tabs i{position:absolute;top:4px;bottom:4px;left:4px;width:calc((100% - 8px)/3);background:var(--ink);border-radius:99px;transform:translateX(calc(var(--i,0)*100%));transition:transform .3s var(--pop)}
  .tabs button{all:unset;position:relative;cursor:pointer;text-align:center;min-height:36px;line-height:36px;font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#fff;border-radius:99px;transition:color .2s}
  .tabs button[aria-selected=true]{color:var(--on-ink)}.tabs .beta{display:inline-block;margin-left:3px;padding:0 4px;line-height:11px;font-size:6.5px;font-weight:800;letter-spacing:.06em;background:var(--yellow);color:#131316;border:1px solid #131316;border-radius:99px;vertical-align:middle;text-transform:uppercase}
  main{flex:1;overflow:auto;padding:16px 18px 24px;display:grid;gap:18px;align-content:start;grid-template-columns:minmax(0,1fr);scrollbar-width:thin}
  main>*{animation:up .3s var(--ease) both;animation-delay:calc(var(--n,0)*35ms)}
  @keyframes up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  .empty{color:var(--ink-2);margin:0;font-size:14px}.meta{font-size:12px;color:var(--ink-2)}.meta:empty{display:none}
  .lbl{margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
  /* price sticker row */
  .hero{display:flex;align-items:center;justify-content:space-between;padding-top:10px}
  .st-wrap{position:relative;padding-top:6px}
  .price{display:inline-block;background:var(--surface);border:2px solid var(--bd);border-radius:12px;padding:8px 16px;font-size:32px;font-weight:800;line-height:1;letter-spacing:-.02em;box-shadow:3px 3px 0 var(--sh);transform:rotate(-2deg);animation:stick .4s var(--pop) both}
  @keyframes stick{from{opacity:0;transform:rotate(-2deg) scale(.88)}to{opacity:1;transform:rotate(-2deg) scale(1)}}
  .tag{position:absolute;left:62%;top:-8px;background:var(--mint);color:#131316;border:2px solid var(--bd);border-radius:99px;padding:2px 10px;font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;transform:rotate(3deg);white-space:nowrap;box-shadow:2px 2px 0 var(--sh);animation:stick2 .45s var(--pop) .15s both}
  .tag.y{background:var(--yellow)}@keyframes stick2{from{opacity:0;transform:rotate(3deg) scale(.7)}to{opacity:1;transform:rotate(3deg) scale(1)}}
  .heart{all:unset;cursor:pointer;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:var(--surface);border:2px solid var(--bd);box-shadow:2px 2px 0 var(--sh);position:relative;transition:transform .12s,background .2s}
  .heart svg{width:20px;height:20px}.heart:active{transform:translate(1px,1px)}.heart.on{background:var(--mint)}.heart.on svg{fill:currentColor;animation:pop .3s var(--pop)}
  @keyframes pop{0%{transform:scale(.7)}100%{transform:scale(1)}}
  .sub2{margin-top:6px;font-size:12px;color:var(--ink-2)}.mrp{text-decoration:line-through;color:var(--ink-3);margin-left:8px}
  .chips3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  .chip3{background:var(--surface);border:2px solid var(--bd);border-radius:14px;box-shadow:3px 3px 0 var(--sh);padding:8px 4px 8px;text-align:center}
  .chip3 small{display:flex;justify-content:center;align-items:center;gap:4px;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.chip3 small svg{width:12px;height:12px}
  .chip3 b{font-size:14px;font-weight:800}
  .chartbox{background:var(--wash);border:2px solid var(--bd);border-radius:16px;box-shadow:3px 3px 0 var(--sh);padding:10px 12px 6px}
  .chartbox{position:relative}.chartbox .lbl{margin:0;color:var(--ink-2)}.cw{position:relative;margin-top:2px}.cw svg{width:100%;height:96px;display:block;overflow:visible;touch-action:pan-y}
  .yl{position:absolute;left:0;font-size:10px;font-weight:800;color:var(--ink-2);background:var(--wash);padding:0 3px;border-radius:4px;pointer-events:none}.yl.t{top:0}.yl.b{bottom:12px}
  .xl{display:flex;justify-content:space-between;font-size:10px;font-weight:800;color:var(--ink-2);margin-top:2px}
  .tip{position:absolute;top:-4px;transform:translateX(-50%);background:var(--ink);color:var(--bg);font-size:11px;font-weight:800;padding:3px 8px;border-radius:99px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .12s}.cw:hover .tip,.cw.touch .tip{opacity:1}
  .chg-pill{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:800;padding:3px 10px;border-radius:99px;border:2px solid var(--bd);background:var(--mint);color:#131316;box-shadow:2px 2px 0 var(--sh)}.chg-pill.up{background:var(--yellow)}
  .ln{stroke-dasharray:1;stroke-dashoffset:1;animation:draw .8s var(--ease) .15s forwards}@keyframes draw{to{stroke-dashoffset:0}}
  .vcard{display:flex;align-items:center;gap:12px;border:2px solid var(--bd);border-radius:16px;box-shadow:3px 3px 0 var(--sh);padding:12px 14px;background:var(--chip);color:#131316}
  .vcard.buy{background:var(--mint)}.vcard.wait{background:var(--yellow)}
  .vw{font-size:18px;font-weight:800;letter-spacing:.02em;text-transform:uppercase}.vl{flex:1;font-size:13px;font-weight:700;line-height:1.25}
  .info{all:unset;cursor:pointer;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.65);border:2px solid #131316;transition:transform .12s}.info:active{transform:scale(.92)}
  .row2{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .meter4{display:flex;gap:5px;flex:1;min-width:110px}.meter4 i{flex:1;height:8px;border-radius:99px;background:var(--line);transition:background .3s}.meter4 i.on{background:var(--mint)}.meter4.lo i.on{background:var(--yellow)}
  .pill{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:0 12px;border-radius:99px;background:var(--chip);border:1.5px solid var(--line);font-size:11px;font-weight:800;letter-spacing:.03em;text-transform:uppercase}
  .pill.y{background:var(--yellow);border-color:var(--bd);color:#131316}
  .trapbox{background:var(--yellow);border:2px solid var(--bd);border-radius:16px;box-shadow:3px 3px 0 var(--sh);padding:12px 14px;color:#131316}
  .trapbox .lbl{display:flex;align-items:center;gap:6px}.trapbox svg{width:16px;height:16px}
  .hd>div:first-child{padding:4px 0 6px 5px;margin:-4px 0 -6px -5px}/* room for the logo's ring and shadow so overflow:hidden no longer shaves its left edge */
  label.row2{align-items:flex-start;flex-wrap:nowrap}.row2 input[type=checkbox]{margin:1px 0 0;flex:none;width:18px;height:18px;accent-color:#131316}.row2 input[type=checkbox]+span{flex:1;min-width:0;line-height:1.35}
  .field{display:flex;gap:8px;align-items:center}.field .pi{flex:1 1 auto;min-width:0}.btn.sm{flex:none;width:auto;min-height:34px;padding:0 10px;font-size:10px;gap:4px}.btn.sm svg{width:12px;height:12px}
  .pi{flex:1;min-width:0;display:flex;align-items:center;gap:8px;height:46px;padding:0 16px;background:#fff;color:#131316;border:2px solid var(--bd);border-radius:99px;box-shadow:2px 2px 0 var(--sh)}
  .pi input{all:unset;flex:1;min-width:0;font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}.pi input::placeholder{color:#666672;font-weight:500}.pi svg{width:16px;height:16px;color:#545459}
  .btn{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:46px;padding:0 20px;border-radius:99px;background:#131316;color:#fff;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;box-shadow:3px 3px 0 var(--mint);transition:transform .12s,box-shadow .12s;position:relative}
  .btn:active{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--mint)}.btn.full{display:flex;width:100%}.btn svg{width:16px;height:16px}
  .btn.ghost{background:var(--surface);color:var(--ink);border:2px solid var(--bd);box-shadow:2px 2px 0 var(--sh);height:46px;padding:0 14px}.btn.ghost svg{width:16px;height:16px}
  .btn.ok{background:var(--mint);color:#131316}.btn .ck{width:16px;height:16px}.btn .ck path{stroke-dasharray:24;stroke-dashoffset:24;animation:tick .3s var(--ease) .05s forwards}@keyframes tick{to{stroke-dashoffset:0}}
  .rp{position:absolute;inset:0;border-radius:inherit;border:2px solid var(--mint);pointer-events:none;animation:rp .6s var(--ease) forwards}@keyframes rp{from{opacity:.9;transform:scale(1)}to{opacity:0;transform:scale(1.4)}}
  /* stores */
  .stores{display:flex;flex-wrap:wrap;gap:8px;padding:2px 3px 6px 1px}
  .store,.more{all:unset;cursor:pointer;flex:none;display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 14px;border-radius:99px;background:var(--surface);border:2px solid var(--bd);box-shadow:2px 2px 0 var(--sh);font-size:13px;font-weight:800;color:var(--ink);text-decoration:none;transition:transform .12s,box-shadow .12s}
  .store:hover,.more:hover{transform:translateY(-2px);box-shadow:2px 4px 0 var(--sh)}.store:active,.more:active{transform:translate(1px,1px);box-shadow:1px 1px 0 var(--sh)}
  .store i{width:10px;height:10px;border-radius:50%;background:var(--c,#999);border:1.5px solid var(--bd)}.more{background:var(--wash)}
  /* results & lists */
  .res{display:flex;align-items:center;gap:12px;padding:10px 2px;color:inherit;text-decoration:none;border-bottom:1.5px dashed var(--line)}
  .sc{flex:none;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:var(--c,#999);border:2px solid var(--bd);font-size:12px;font-weight:800;color:#131316}
  .rn{flex:1;min-width:0}.rn span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700}.rn small{color:var(--ink-2)}
  .rp2{text-align:right;white-space:nowrap}.rp2 b{font-size:16px;font-weight:800;display:block}.rp2 small{font-size:11px;color:var(--ink-2)}
  .pgo{flex:none;width:32px;height:32px;padding:0;border-radius:50%;border:2px solid var(--bd);display:grid;place-items:center;background:var(--chip);color:var(--ink-3);cursor:pointer;font:inherit}.pgo svg{width:16px;height:16px}
  .pgo.dirty{background:var(--mint);color:#131316;animation:pgopulse 1.6s ease-out infinite}.pgo.bad{opacity:.4;cursor:not-allowed}.pgo.done{background:var(--mint);color:#131316}
  @media (max-width:600px){.pgo{width:44px;height:44px}.wtop .t a{padding:13px 0;margin:-13px 0}}
  .scan{border:2px solid var(--bd);border-radius:16px;box-shadow:3px 3px 0 var(--sh);padding:12px;background:var(--surface);margin-top:12px}.scan-h{display:flex;justify-content:space-between;align-items:center;font-weight:800}
  .scan-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px 0}.scan-pill{border:2px solid currentColor;border-radius:999px;padding:6px 14px;font-weight:800;font-size:15px}
  .scan.mirage .scan-pill,.scan.mirage .scan-head{color:#C62E34}.scan.meh .scan-pill{color:#B45F06}.scan.fair .scan-pill{color:#8A6D00}.scan.real .scan-pill{color:#0B7A47}
  .gauge{width:120px;flex:none}.gauge svg{display:block;width:120px;height:70px}.gnum{text-align:center;font-weight:800;font-size:20px;line-height:1;margin-top:-4px}.gnum small{display:block;font-size:10px;font-weight:600;color:var(--ink-3);margin-top:2px}
  .scan-head{background:var(--chip);border-radius:12px;padding:10px 12px;font-weight:800}.scan.real .scan-head{color:#0B7A47}
  .scan-rows{margin-top:8px}.scan-r{display:grid;grid-template-columns:1fr auto auto;gap:10px;padding:7px 0;border-top:1px solid var(--line);font-size:13px;align-items:center}.scan-r b{min-width:42px;text-align:right}.scan-r.bad span:first-child{color:#C62E34;font-weight:800}
  .seller{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;margin-top:12px;padding:12px;border:2px solid var(--bd);border-radius:16px;box-shadow:3px 3px 0 var(--sh);background:var(--surface);cursor:pointer}.seller .lbl{margin:0 0 2px;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);display:block}
  .s-mid{min-width:0;display:grid;gap:4px}.sname{font-weight:800;font-size:15px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}.skind{display:inline-block;justify-self:start;font-size:11px;font-weight:800;padding:2px 10px;border-radius:99px;border:1.5px solid var(--bd)}.seller.good .skind{background:var(--mint)}.seller.watch .skind{background:var(--yellow,#FFD93D)}
  .s-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}.schip{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:800;padding:3px 8px;border-radius:99px;background:var(--chip)}.schip svg{width:13px;height:13px}.schip.ok{color:#0B7A47}.schip.warn{color:#B45F06}
  .rdot{width:14px;height:14px;border-radius:50%;border:3px solid var(--c);display:inline-block;flex:none;background:var(--surface)}.off-r{grid-template-columns:auto 1fr auto!important;align-items:center}.off-r small{grid-column:1/-1}
  .rev{all:unset;box-sizing:border-box;display:block;width:100%;margin-top:12px;padding:12px;border:2px solid var(--bd);border-radius:14px;background:var(--surface);cursor:pointer}.rev .lbl{margin:0 0 4px;color:var(--ink-3)}
  .rev-h{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:15px;margin-bottom:2px}.rev.good .rev-h b{color:#0B7A47}.rev.bad .rev-h b{color:#C62E34}.rev.mixed .rev-h b{color:#8A6D00}.rev-avg{font-weight:800}
  .rev-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.rchip{font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;border:1.5px solid currentColor}.rchip.up{color:#0B7A47}.rchip.dn{color:#B45F06}
  .cmp{margin-bottom:10px}.cmp .meta{margin:6px 0 0}.cmp-r{all:unset;box-sizing:border-box;display:grid;grid-template-columns:1fr auto auto;gap:2px 10px;align-items:center;width:100%;padding:10px 12px;margin-top:6px;border:2px solid var(--bd);border-radius:14px;background:var(--surface);font-size:14px;font-weight:700;cursor:default}a.cmp-r{cursor:pointer;color:var(--ink)}.cmp-r small{grid-column:1/-1;font-size:11px;font-weight:600;color:var(--ink-3)}
  .cmp-r .tag{font-size:12px;font-weight:800;color:var(--ink-2)}.cmp-r.low{background:var(--mint);color:#131316;border-color:#131316}.cmp-r.low .tag,.cmp-r.low small{color:#131316}
  .chip3.hi{background:#FFE9E6}.chip3 em.dlt.good{color:#0B7A47}.chip3 em.dlt.bad{color:#C8281B}.chip3 em.dlt{display:block;font-style:normal;font-size:10px;font-weight:700;color:var(--ink-2);margin-top:2px}.chip3.flash{animation:chg .7s var(--ease)}@keyframes chg{0%{background:var(--yellow);transform:scale(1.05)}100%{background:var(--surface);transform:none}}
  .seg button.beyond{opacity:.55}.bandc .yl{position:absolute;right:0}
  .bn-body.busy{pointer-events:none}.skel{height:44px;border-radius:14px;margin-top:10px;background:var(--chip);border:2px solid var(--bd);opacity:.7;animation:skel 1s ease-in-out infinite}.skel:nth-child(2){width:70%;animation-delay:.1s}.skel:nth-child(3){width:45%;animation-delay:.2s}@keyframes skel{50%{opacity:.35}}
  .bn-body.fresh{animation:up .25s var(--ease)}.info{position:relative}.itip{position:absolute;right:0;bottom:calc(100% + 8px);width:210px;padding:8px 10px;border-radius:12px;background:var(--ink);color:var(--bg);font-size:12px;font-weight:600;line-height:1.35;text-align:left;opacity:0;pointer-events:none;transform:translateY(4px);transition:opacity .12s,transform .12s;z-index:5}.info:hover .itip,.info:focus-visible .itip{opacity:1;transform:none}
  .impulse{all:unset;box-sizing:border-box;display:block;width:100%;margin-top:12px;padding:12px;border:2px solid var(--bd);border-radius:16px;box-shadow:3px 3px 0 var(--sh);background:var(--surface);cursor:pointer}.impulse.restarted,.impulse.repeated{background:var(--yellow)}.impulse.steady{background:var(--chip)}.imp-top{display:flex;align-items:center;gap:8px;justify-content:space-between;margin-bottom:8px}.imp-head{font-size:14px;font-weight:800}.impulse .meta{margin:6px 0 0}.impulse:focus-visible{outline:3px solid var(--ring);outline-offset:2px}
  .offers{margin-top:12px}.off-r.dim{opacity:.6}.off-save{margin:0 0 6px;font-weight:800;color:#0B7A47}.off-r{all:unset;box-sizing:border-box;display:grid;grid-template-columns:1fr auto;gap:2px 10px;width:100%;padding:10px 12px;margin-top:6px;border:2px solid var(--bd);border-radius:14px;background:var(--surface);font-size:14px;font-weight:700}a.off-r{cursor:pointer;color:var(--ink)}.off-r .on{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.off-r small{grid-column:1/-1;font-size:11px;font-weight:600;color:var(--ink-3)}.off-r.low{background:var(--mint);color:#131316;border-color:#131316}.off-r.low small{color:#131316}
  .refbar{padding:8px 4px 0}.rb-track{position:relative;height:12px;border-radius:99px;border:2px solid var(--bd);background:var(--mint)}.rb-dot{position:absolute;top:-5px;width:18px;height:18px;border-radius:50%;background:var(--ink);border:3px solid var(--surface);box-shadow:0 0 0 2px var(--ink)}.rb-lab{display:flex;justify-content:space-between;margin-top:8px;font-weight:800;font-size:13px}.refbar .meta{margin:8px 0 0}
.cmp-sum{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;padding:10px 12px;border:2px solid var(--bd);border-radius:14px;box-shadow:3px 3px 0 var(--sh);background:var(--chip);margin-bottom:4px}.cmp-sum.save{background:var(--mint)}.cmp-sum .cs-k{font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}.cmp-sum b{font-size:22px;font-weight:800}.cmp-sum .cs-d{font-size:13px;font-weight:700}.cmp-sum svg{width:16px;height:16px;align-self:center}
  .cmp-r .sn{display:flex;align-items:center;gap:8px;font-weight:800}.sdot{width:12px;height:12px;border-radius:50%;border:2px solid var(--ink);flex:none}.cmp-r .cbadge{font-size:12px;font-weight:800;color:var(--ink-2);white-space:nowrap;justify-self:end}.cmp-r .cbadge.dn{color:#0B7A47}.cmp-r .cbadge.up{color:#B45F06}.cmp-r.low .cbadge{color:#131316}
  .pbar{grid-column:1/-1;height:6px;border-radius:99px;background:var(--wash);overflow:hidden;margin-top:6px}.pbar i{display:block;height:100%;border-radius:99px;background:var(--ink);opacity:.55;animation:grow .6s var(--ease) both}.cmp-r.low .pbar i{background:var(--ink);opacity:1}@keyframes grow{from{width:0!important}}
  .cf{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:800}.cf svg{width:12px;height:12px}.cf.ex{color:#0B7A47}.cf.lk{color:#B45F06}
  .cmp-r.near{opacity:.75;border-style:dashed}
  .same{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-top:4px}.same b{font-size:11px;font-weight:800;margin-right:2px}.chk{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:700;padding:2px 7px;border-radius:99px;background:var(--chip);color:var(--ink)}.chk svg{width:12px;height:12px}.chk.y{color:#0B7A47}.chk.u{color:var(--ink-3)}.chk.n{color:#B45F06}.cmp-r.low .chk{background:#fff;color:#131316}
  .buynow{border:2px solid var(--bd);border-radius:16px;box-shadow:3px 3px 0 var(--sh);padding:12px;margin-top:12px;background:var(--surface)}.bn-h{font-size:14px!important;letter-spacing:0!important;text-transform:none!important}.buynow .seg{margin:6px 0}.bn-row{display:flex;gap:10px;align-items:center;margin-top:6px}.bn-right{flex:1;min-width:0}.bn-g{flex:none}.bn-lg{display:flex;gap:8px;justify-content:center;font-size:10px;font-weight:700;margin-top:2px}.bn-lg span::before{content:"";display:inline-block;width:8px;height:8px;margin-right:3px;border-radius:2px;background:#E5484D}.bn-lg .good::before{background:#19B968}.bn-right .lbl{margin:0 0 4px}.bn-right .vcard{margin:0;flex-direction:column;align-items:flex-start;gap:4px;padding:10px 40px 10px 12px;position:relative}.bn-right .vcard .vw{font-size:18px}.bn-right .vcard .vl{font-size:13px}.bn-right .vcard .info{position:absolute;top:8px;right:8px}.buynow .btn{margin-top:10px}
  @keyframes pgopulse{0%{box-shadow:0 0 0 0 rgba(25,230,140,.7)}100%{box-shadow:0 0 0 10px rgba(25,230,140,0)}}
  .plc{display:inline-flex;align-items:center}.plc .cp{border-top-right-radius:0;border-bottom-right-radius:0;border-right-width:1px}.cp-x{width:30px;height:100%;min-height:34px;border:2px solid var(--bd);border-left-width:1px;border-radius:0 99px 99px 0;background:var(--surface);color:var(--ink-2);display:grid;place-items:center;cursor:pointer;padding:0;box-shadow:2px 2px 0 var(--sh)}.cp-x svg{width:12px;height:12px}
  .gbox{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;min-width:0}.gbox>:empty,.gbox>[hidden]{display:none}.gbox .meta,.gbox .meta.strong{margin:0}.gbox .btn.full{margin:0}
  .places{display:flex;flex-wrap:wrap;gap:6px;margin:0;align-items:center}.places .cp{flex:none}.cp.add{background:var(--yellow);color:#131316}.cp.del{color:#C0262D}
  .pform,.prow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;width:100%;margin:2px 0}.mini{font:inherit;font-weight:700;min-height:40px;padding:0 12px;border:2px solid var(--bd);border-radius:99px;background:var(--surface);color:var(--ink);min-width:0;flex:1 1 120px;box-sizing:border-box}.mini.pin{flex:0 0 96px}
  .meta.bad{color:#C0262D;flex-basis:100%}.meta.strong{font-weight:700;color:var(--ink);margin:0}
  /* grocery card grid */
  .chipsrow{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 10px;scrollbar-width:none}.chipsrow::-webkit-scrollbar{display:none}
  .cp{flex:none;font:700 11px/1 inherit;letter-spacing:.04em;text-transform:uppercase;padding:9px 12px;border-radius:99px;border:2px solid var(--bd);background:var(--surface);color:var(--ink);box-shadow:2px 2px 0 var(--sh);cursor:pointer}
  .cp[aria-pressed="true"]{background:var(--ink);color:var(--surface)}
  .ggrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(138px,1fr));gap:10px}
  .card{display:flex;flex-direction:column;gap:4px;background:var(--surface);border:2px solid var(--bd);border-radius:16px;box-shadow:3px 3px 0 var(--sh);overflow:hidden;color:inherit;text-decoration:none;padding:0 0 8px}
  .card.best{background:var(--surface);padding:0 0 10px;margin:0;outline:3px solid var(--mint);outline-offset:-3px}.card.so{opacity:.6}
  .card>*{flex:none}.ph{position:relative;aspect-ratio:4/3;background:#fff;display:grid;place-items:center;border-bottom:2px solid var(--bd)}.ph img{width:100%;height:100%;object-fit:contain;padding:8px;box-sizing:border-box}
  .cb{position:absolute;left:8px;top:8px;font-style:normal;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;background:var(--mint);color:#131316;border:2px solid var(--bd);border-radius:99px;padding:3px 8px}.cb.v{background:var(--yellow)}.cb.o{background:#fff;top:auto;bottom:8px}
  .pk{margin:0 10px;font-size:11px;font-weight:700;color:var(--ink-2)}.nm{margin:0 10px;font-size:12px;font-weight:700;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.5em}
  .fr{margin:2px 10px 0;font-size:10px;font-weight:700;letter-spacing:.04em;color:var(--ink-2)}.pr{margin:0 10px;display:flex;align-items:center;justify-content:space-between;gap:6px}.pr b{font-size:16px;font-weight:800}.pr s{font-size:11px;color:var(--ink-2);margin-left:6px}
  .pl{margin:0 10px;color:var(--ink-2);font-size:11px}
  .lg{flex:none;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;overflow:hidden;background:var(--c,#fff);border:2px solid var(--bd);font-size:11px;font-weight:800;color:#131316}.lg img{width:100%;height:100%;object-fit:cover;display:block}.lg.off{filter:grayscale(1);opacity:.55}
  .atc{margin:4px 10px 0;text-align:center;font-size:12px;font-weight:800;color:var(--blue,#0754F8);border:2px solid var(--blue,#0754F8);border-radius:10px;padding:5px 0}
  .nodel{display:flex;align-items:center;gap:8px;margin-top:12px;padding:10px 12px;border:2px dashed var(--line);border-radius:14px;background:var(--chip);font-size:12px;font-weight:700;color:var(--ink-2)}
  .best{border:2px solid var(--bd);border-radius:16px;box-shadow:3px 3px 0 var(--sh);background:var(--mint);padding:12px 14px;margin-bottom:10px;color:#131316}.best .sc{background:#fff}.best small{color:#131316}
  .best em{font-style:normal;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;display:block;margin-bottom:2px}
  .item{display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1.5px dashed var(--line)}
  .item img{width:48px;height:48px;object-fit:contain;border-radius:12px;background:var(--chip);border:2px solid var(--bd);flex:none}
  .item .t{flex:1;min-width:0}.item .t a{color:inherit;font-weight:700;text-decoration:none;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.item .p{font-size:16px;font-weight:800}
  .chg{font-size:11px;font-weight:800;margin-left:6px;padding:1px 8px;border-radius:99px;border:1.5px solid var(--bd);background:var(--mint);color:#131316}.chg.up{background:var(--yellow)}
  .wl{border-radius:16px;padding:16px;color:#fff;background:#131316;border:2px solid var(--bd);box-shadow:3px 3px 0 var(--mint);position:relative}.wl b{display:block;font-size:15px;margin-bottom:2px}.wl .btn{background:var(--mint);color:#131316;box-shadow:none;margin-top:12px}
  .sk{height:var(--h,16px);border-radius:12px;background:linear-gradient(90deg,var(--chip) 25%,var(--line) 50%,var(--chip) 75%);background-size:200% 100%;animation:sh 1.2s linear infinite}@keyframes sh{to{background-position:-200% 0}}
  .quota{display:flex;align-items:center;gap:10px;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}.quota .bar{flex:1;height:8px;border-radius:99px;background:var(--line);overflow:hidden}.quota .bar i{display:block;height:100%;background:var(--mint);transform-origin:left;animation:grow .7s var(--ease) both}@keyframes grow{from{transform:scaleX(0)}}
  /* stepper, trap rows, range selector */
  .stp-row{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}.stp{position:relative;flex:1;min-width:190px}
  .stp-box{display:flex;align-items:center;gap:6px;background:#fff;color:#131316;border:2px solid var(--bd);border-radius:99px;box-shadow:2px 2px 0 var(--sh);padding:4px;transition:border-color .15s}
  .stp.bad .stp-box{border-color:#E5484D}
  .stp-b{all:unset;flex:none;width:40px;height:40px;border-radius:50%;background:#131316;color:#fff;display:grid;place-items:center;cursor:pointer;transition:transform .1s,background .15s;touch-action:none;user-select:none}
  .stp-b:active{transform:scale(.92);background:var(--mint);color:#131316}.stp-b svg{width:18px;height:18px}
  .stp-in{flex:1;min-width:0;display:flex;align-items:center;justify-content:center;gap:2px;font-size:16px;font-weight:800;font-variant-numeric:tabular-nums}.stp-in input{all:unset;width:100%;min-width:0;text-align:left;font-weight:800;font-size:16px}
  .stp-msg{margin-top:6px;font-size:12px;font-weight:700;color:#131316}.stp.bad .stp-msg{background:var(--yellow);border:2px solid var(--bd);border-radius:10px;padding:5px 10px}.stp-msg:empty{display:none}
  .stp-tick{position:absolute;right:6px;top:-18px;display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:800;color:#067A4B;opacity:0;transform:translateY(4px);transition:all .25s var(--ease);pointer-events:none}.stp-tick svg{width:13px;height:13px}.stp-tick.on{opacity:1;transform:none}
  .link-btn{all:unset;cursor:pointer;align-self:center;font-size:12px;font-weight:800;text-decoration:underline;text-underline-offset:3px;padding:10px 4px;min-height:24px}
  .wlist{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}.wrow{min-width:0;border:2px solid var(--bd);border-radius:16px;box-shadow:3px 3px 0 var(--sh);padding:12px;background:var(--surface)}
  .wtop{display:flex;gap:12px;align-items:center}.wtop img{width:52px;height:52px;object-fit:contain;border-radius:12px;background:var(--chip);border:2px solid var(--bd);flex:none}
  .wtop .t{flex:1;min-width:0}.wtop .t a{color:inherit;font-weight:700;text-decoration:none;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wtop .p{font-size:18px;font-weight:800}
  .trap-line{display:flex;align-items:center;gap:10px;margin-top:12px;padding-top:12px;border-top:1.5px dashed var(--line)}.trap-line .tl{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2)}.trap-line .stp{flex:1;min-width:0}.trap-line{min-width:0}
  .seg{display:flex;gap:2px;background:var(--chip);border:2px solid var(--bd);border-radius:99px;padding:3px}
  .seg button{all:unset;flex:1;text-align:center;min-height:34px;line-height:34px;font-size:12px;font-weight:800;border-radius:99px;cursor:pointer;transition:background .2s,color .2s}.seg button[aria-pressed=true]{background:var(--ink);color:var(--on-ink)}
  .seg button:focus-visible{outline:3px solid var(--ring);outline-offset:1px}
  /* detail sheet */
  .scrim{position:absolute;inset:0;background:rgba(19,19,22,.45);opacity:0;pointer-events:none;transition:opacity .25s}.sheetopen .scrim{opacity:1;pointer-events:auto}
  .sheet{position:absolute;left:0;right:0;bottom:0;max-height:78%;overflow:auto;background:var(--bg);border-top:2px solid var(--bd);border-radius:20px 20px 0 0;padding:18px;transform:translateY(105%);transition:transform .3s var(--ease);display:grid;gap:12px}
  .sheet-h{display:flex;align-items:center;justify-content:space-between;gap:12px}.sheet-h .x{flex:none}
  .sheetopen .sheet{transform:none}.sheet h4{margin:0;font-size:16px;font-weight:800}.sheet ul{margin:0;padding-left:18px;color:var(--ink-2)}.sheet li{margin:6px 0}
  .sheet .note{padding:10px 12px;border-radius:12px;background:var(--chip);border:1.5px solid var(--line)}.sheet .note b{display:block;margin-bottom:2px}
  @media (max-width:600px){
    .x.cl{display:inline-flex}.hd .brand h1,.hd .brand .sub{display:none}
    .knob{border-radius:22px 0 0 22px;min-width:48px}.open .knob{right:0;opacity:0;pointer-events:none}
    .panel{top:auto;bottom:0;left:0;right:0;width:100%;height:78dvh;border-radius:22px 22px 0 0;transform:translateY(104%);border-top:2px solid var(--bd)}.open .panel{transform:none}
    header{padding-top:22px;position:relative}header::before{content:"";position:absolute;top:8px;left:50%;width:40px;height:4px;margin-left:-20px;border-radius:2px;background:var(--bd);opacity:.3}
    main{padding-bottom:calc(24px + env(safe-area-inset-bottom))}.pi input{font-size:16px}
    .x,.pinchip,.info,.heart{min-width:44px;min-height:44px}.pinchip{padding:0 14px}.tabs button{min-height:44px;line-height:44px}.pill,.store,.more,.btn,.btn.ghost,.seg button,.link-btn,.stp-b{min-height:44px}.stp-b{width:44px;height:44px}.seg button{line-height:44px}.pi{height:48px}.pi input{min-height:44px}.chip3{min-height:44px}
  }
  .w button:focus-visible,.w a:focus-visible,.w summary:focus-visible,.w .panel:focus-visible,.w .sheet h4:focus-visible{outline:3px solid var(--ring);outline-offset:2px}
  .w input,.w input:focus,.w input:focus-visible{outline:none;box-shadow:none}.pi:focus-within,.stp-box:focus-within{box-shadow:3px 3px 0 var(--sh)}.panel:focus{outline:none}
  .mrp{color:var(--ink-2)}
  .hit{display:inline-block;margin-top:10px;font-size:12px;font-weight:800;background:var(--mint);color:#131316;border:2px solid var(--bd);border-radius:99px;padding:3px 10px}.wrow .meta.al{margin:8px 0 0}
  .undo{position:absolute;left:18px;right:18px;bottom:18px;z-index:4;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 8px 6px 16px;background:var(--ink);color:#fff;border-radius:99px;font-size:13px;font-weight:700;box-shadow:3px 3px 0 var(--mint)}.undo button{all:unset;cursor:pointer;font-weight:800;color:var(--mint);padding:8px 12px;border-radius:99px;text-decoration:underline}.undo button:focus-visible{outline:3px solid #fff}
  .row2 input:disabled+span{color:var(--ink-2)}
  .wl .wlm{margin:8px 0 0;font-size:12px;font-weight:700}.wlm:empty{display:none}
  /* verdict nudge + lookup-limit card: calm, never blurs or hides the verdict */
  .nudge{margin-top:12px;padding:10px 12px;border:2px solid var(--bd);border-radius:14px;background:var(--wash);display:grid;gap:8px;animation:up .25s var(--ease) both}
  .nudge-t{margin:0;font-size:14px;font-weight:800}.nudge-t svg{width:16px;height:16px;vertical-align:-3px;margin-right:6px}.nudge .meta{margin:0}
  .nudge.ok{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 12px}
  .nudge-a{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.nudge-a .btn{padding:0 16px}.nudge .btn{margin-top:0}.nudge .link-btn,.limitcard .link-btn{min-height:44px;padding:10px 12px;box-sizing:border-box;display:inline-flex;align-items:center}.nudge .stp-msg,.nudge-m{margin:0;font-size:12px;font-weight:700}.nudge-m:empty{display:none}
  .limitcard{border:2px solid var(--bd);border-radius:16px;box-shadow:3px 3px 0 var(--sh);padding:14px;background:var(--wash);display:grid;gap:10px}.limitcard h3{margin:0;font-size:16px;font-weight:800;line-height:1.25}.limitcard p{margin:0}.limitcard .nudge-a{margin-top:2px}
  @media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:1ms!important;animation-delay:0s!important;transition-duration:1ms!important}}
  .ggrid + .btn.sm,.gbox .btn.sm.later{margin-top:12px}
  /* grocery results: even spacing, wrapping text, search + button on one line on wide pages */
  .gout{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}.gout .meta,.gout .empty,.gout .lbl{margin:0;overflow-wrap:anywhere}.gout .stores{padding:0}
  .srow{display:grid;gap:8px}.srow .btn.full{margin:0}
    .gout .btn.sm{justify-self:start}.gout .lbl + .stores,.gout .lbl + .stores.wrap{margin-top:6px}
`,
};
