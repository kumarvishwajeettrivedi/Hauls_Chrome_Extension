const assert = require('assert');
const S = require('./shopify.js');
assert.strictEqual(globalThis.Shopify_, S);

// trimmed real response: https://www.boat-lifestyle.com/products/boat-lunar-connect-2.js (2026-10-16)
const FIX = {"id":10331988656226,"title":"boAt Lunar Connect 2 | HD Smartwatch","handle":"boat-lunar-connect-2","price":149900,"compare_at_price":649900,"available":true,"featured_image":"//cdn.shopify.com/s/files/1/0057/8938/4802/files/Mainimage.png?v=1","variants":[{"id":50609347493986,"title":"Active Black","price":149900,"compare_at_price":649900,"available":true},{"id":50609347526754,"title":"Metal Black","price":169900,"compare_at_price":749900,"available":true},{"id":3,"title":"Sold out","price":99900,"compare_at_price":null,"available":false}]};
const fake = (body, ok = true) => async (u, o) => { fake.last = [u, o]; return { ok, json: async () => body }; };

(async () => {
  assert.strictEqual(S.productHandle('https://a.in/products/foo-bar?variant=1'), 'foo-bar');
  assert.strictEqual(S.productHandle('https://a.in/collections/x/products/foo'), 'foo');
  assert.strictEqual(S.productHandle('https://a.in/collections/x'), null);

  let p = await S.fetchShopifyProduct('https://www.boat-lifestyle.com', 'boat-lunar-connect-2', fake(FIX));
  assert.deepStrictEqual(fake.last, ['https://www.boat-lifestyle.com/products/boat-lunar-connect-2.js', { credentials: 'omit', headers: { Accept: 'application/json' } }]);
  assert.strictEqual(p.key, 'shopify:www.boat-lifestyle.com:boat-lunar-connect-2');
  assert.strictEqual(p.price, 1499); assert.strictEqual(p.mrp, 6499); // paise -> rupees
  assert.ok(p.image.startsWith('https://cdn.shopify.com'));
  assert.strictEqual(p.variants.length, 3);

  p = await S.fetchShopifyProduct('https://www.boat-lifestyle.com', 'h', fake(FIX), '/products/h?variant=50609347526754');
  assert.strictEqual(p.price, 1699); assert.strictEqual(p.mrp, 7499);
  p = await S.fetchShopifyProduct('https://www.boat-lifestyle.com', 'h', fake(FIX), '/products/h?variant=3');
  assert.strictEqual(p.mrp, 999); assert.strictEqual(p.available, false); // no higher compare_at -> mrp = price
  assert.strictEqual(await S.fetchShopifyProduct('https://x.in', 'h', fake({}, false)), null);

  // detection with minimal DOM stub
  const doc = (hits, scripts = []) => ({
    querySelector: (sel) => hits.some((h) => sel.includes(h)) ? {} : null,
    querySelectorAll: () => scripts.map((t) => ({ textContent: t })),
  });
  assert.ok(S.isShopifyDocument(doc(['shopify-digital-wallet'])));
  assert.ok(S.isShopifyDocument(doc([], ['var x=1; window.ShopifyAnalytics = {}'])));
  assert.ok(!S.isShopifyDocument(doc([], ['var a=1'])));
  console.log('shopify.test.js OK');
})().catch((e) => { console.error(e); process.exit(1); });
