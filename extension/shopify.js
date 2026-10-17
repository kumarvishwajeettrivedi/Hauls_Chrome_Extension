// Shopify storefront detection + price extraction via /products/<handle>.js (no CSS selectors).
(function (root) {
  var SIGNALS = /cdn\.shopify\.com|Shopify\.shop|ShopifyAnalytics|\/cart\.js/;

  function isShopifyDocument(doc) {
    if (!doc || !doc.querySelector) return false;
    if (doc.querySelector('meta[name="shopify-checkout-api-token"], meta[name="shopify-digital-wallet"]')) return true;
    if (doc.querySelector('script[src*="cdn.shopify.com"], link[href*="cdn.shopify.com"], img[src*="cdn.shopify.com"], form[action*="/cart/add"]')) return true;
    var scripts = doc.querySelectorAll('script:not([src])');
    for (var i = 0; i < scripts.length; i++) if (SIGNALS.test(scripts[i].textContent || '')) return true;
    return false;
  }

  // handles /products/h, /collections/x/products/h, /en-in/products/h
  function productHandle(url) {
    try {
      var m = new URL(url, 'https://x.invalid').pathname.match(/\/products\/([^\/?#]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }

  // ponytail: .js prices are integer minor units (paise); /100 assumes 2-decimal currency (true for INR)
  var rupees = function (n) { return n == null ? null : n / 100; };
  var img = function (s) { return s ? (s.indexOf('//') === 0 ? 'https:' + s : s) : null; };

  async function fetchShopifyProduct(origin, handle, fetchImpl, pageUrl) {
    fetchImpl = fetchImpl || fetch;
    var r = await fetchImpl(origin + '/products/' + encodeURIComponent(handle) + '.js', { credentials: 'omit', headers: { Accept: 'application/json' } });
    if (!r.ok) return null; // 404/403 = endpoint disabled or not Shopify
    var p;
    try { p = await r.json(); } catch (e) { return null; }
    if (!p || !Array.isArray(p.variants) || !p.variants.length) return null;
    var vid = pageUrl && (new URL(pageUrl, origin).searchParams.get('variant'));
    var v = p.variants.filter(function (x) { return String(x.id) === vid; })[0] ||
            p.variants.filter(function (x) { return x.available; })[0] || p.variants[0];
    var price = rupees(v.price), cmp = rupees(v.compare_at_price);
    var host = new URL(origin).host;
    return {
      key: 'shopify:' + host + ':' + handle, site: host, id: handle, title: p.title,
      image: img(p.featured_image || (p.images || [])[0]),
      price: price, mrp: cmp && cmp > price ? cmp : price, available: !!v.available,
      variants: p.variants.map(function (x) { return { id: x.id, title: x.title, price: rupees(x.price), available: !!x.available }; }),
      url: origin + '/products/' + handle + (vid ? '?variant=' + v.id : '')
    };
  }

  var api = { isShopifyDocument: isShopifyDocument, productHandle: productHandle, fetchShopifyProduct: fetchShopifyProduct };
  root.Shopify_ = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
