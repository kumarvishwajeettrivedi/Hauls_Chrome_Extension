// Live-site extraction QA helpers.
export const BLOCK = /access denied|robot check|captcha|enter the characters|unusual traffic|just a moment|something went wrong|are you a human|verify you are|temporarily blocked|service unavailable|reference #/i;

// Runs in the page: the visible main price + any struck-through prices (independent of the extension's selectors).
export function pageTruth() {
  const re = /^(?:₹|Rs\.?)\s?([\d,]+(?:\.\d+)?)$/, num = s => parseFloat(String(s).replace(/[^\d.]/g, ""));
  const struck = [], cands = [];
  if (/amazon/.test(location.hostname)) {
    const e = document.querySelector("#corePrice_feature_div .a-price:not(.a-text-price) .a-price-whole, #apex_desktop .a-price:not(.a-text-price) .a-price-whole, .priceToPay .a-price-whole");
    const s = document.querySelector("#corePrice_feature_div .a-text-price .a-offscreen, .basisPrice .a-offscreen, #apex_desktop .a-text-price .a-offscreen");
    return { price: e ? num(e.textContent) : null, struck: s ? [num(s.textContent)] : [] };
  }
  const lt = e => { for (let n = e, i = 0; n && i < 3; n = n.parentElement, i++) if (getComputedStyle(n).textDecorationLine.includes("line-through")) return true; return false; };
  for (const e of document.querySelectorAll("span,div,s,del,strong,p")) {
    if (e.children.length > 1) continue; const t = e.textContent.trim(), m = t.match(re); if (!m) continue;
    const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || r.top > 1400) continue;
    if (lt(e)) struck.push(num(m[1])); else cands.push({ v: num(m[1]), fs: parseFloat(getComputedStyle(e).fontSize), top: r.top });
  }
  cands.sort((a, b) => b.fs - a.fs || a.top - b.top);
  return { price: cands.length ? cands[0].v : null, struck, cands: cands.slice(0, 4) };
}
export const pageState = () => ({ title: document.title, body: (document.body ? document.body.innerText : "").slice(0, 600) });

export const CASES = [
  { id: "amazon-keyboard", site: "amazon.in", kind: "keyboard", list: "https://www.amazon.in/s?k=mechanical+keyboard", link: "a[href*='/dp/']", want: /keyboard/i },
  { id: "amazon-clothing", site: "amazon.in", kind: "clothing", list: "https://www.amazon.in/s?k=men+polo+tshirt", link: "a[href*='/dp/']" },
  { id: "flipkart-keyboard", site: "flipkart.com", kind: "keyboard", list: "https://www.flipkart.com/search?q=mechanical%20keyboard", link: "a[href*='/p/itm']", want: /keyboard/i },
  { id: "flipkart-clothing", site: "flipkart.com", kind: "clothing", list: "https://www.flipkart.com/search?q=men%20jeans", link: "a[href*='/p/itm']" },
  { id: "myntra-clothing", site: "myntra.com", kind: "clothing", list: "https://www.myntra.com/men-tshirts", link: "a[href$='/buy']" },
  // Reliance links without a trailing numeric id (e.g. ...-kv9j3c) are not trackable by design, so `ok` picks one the id pattern accepts.
  { id: "reliance-keyboard", site: "reliancedigital.in", kind: "other", list: "https://www.reliancedigital.in/products?q=mechanical%20keyboard", link: "a[href*='/product/']", ok: /\/product\/[^/?#]+-\d+\/?(\?|#|$)/ },
  { id: "tatacliq-shirt", site: "tatacliq.com", kind: "other", list: "https://www.tatacliq.com/search/?searchCategory=all&text=shirt", link: "a[href*='/p-mp']" },
  { id: "snapdeal-keyboard", site: "snapdeal.com", kind: "other", list: "https://www.snapdeal.com/search?keyword=mechanical%20keyboard", link: "a[href*='/product/']" },
];
