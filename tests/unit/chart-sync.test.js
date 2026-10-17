// Shared-history client side: what is uploaded is validated and compact; the outbox accepts chart ops and nothing else new.
const assert = require("assert");
global.HAULS_CONFIG = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "k" };
const { toChartArgs, coalesce } = require("../../extension/sync.js"), { safeOutbox } = require("../../extension/lib.js");
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const D = 864e5, T0 = Date.UTC(2026, 9, 17, 12);
const a = toChartArgs({ key: "amazon.in:B0X", range: 30, current: 4499, series: [[T0 - 29 * D, 5499], [T0 - 10 * D, 4499], [T0 - 10 * D + 3600e3, 4499.004], [T0, 4499]] });
ok(a.p_key === "amazon.in:B0X" && a.p_range === 30 && a.p_current === 4499, "args header");
ok(a.p_series.length === 3 && a.p_series.every(p => Number.isInteger(p[0])) && a.p_series[1][1] === 4499 && a.p_series[0][1] === 5499, "one point per day, integer day numbers, rounded to 2 decimals: " + JSON.stringify(a.p_series));
ok(a.p_series[0][0] === Math.floor((T0 - 29 * D) / D), "day number = epoch day");
const rg = r => toChartArgs({ key: "k", range: r, current: 1, series: [[T0 - D, 1], [T0, 1]] }).p_range; ok(rg(29) === 30 && rg(30) === 30 && rg(90) === 90 && rg(60) === 90 && rg(365) === 365 && rg(200) === 365 && rg(3) === 30, "ranges are bucketed to 30/90/365");
const big = toChartArgs({ key: "k", range: 365, current: 1000, series: Array.from({ length: 365 }, (_, i) => [T0 - (365 - i) * D, 1000]) });
ok(big.p_series.length <= 130 && big.p_series[big.p_series.length - 1][0] === Math.floor((T0 - D) / D) , "365 daily points are thinned to <= 130 and keep the last: " + big.p_series.length);
// outbox
const op = { t: "chart", key: "k", range: 30, current: 5, series: [[T0 - D, 5], [T0, 5]], id: "a" };
ok(safeOutbox([op]).length === 1, "chart op accepted by the outbox filter");
ok(safeOutbox([{ ...op, series: [[1, 2]] }]).length === 0 && safeOutbox([{ ...op, series: "x" }]).length === 0 && safeOutbox([{ ...op, series: Array.from({ length: 131 }, () => [1, 2]) }]).length === 0 && safeOutbox([{ ...op, series: [["a", 1], [2, 3]] }]).length === 0, "malformed chart ops are dropped");
ok(safeOutbox([{ t: "evil", key: "k" }]).length === 0, "unknown op types still dropped");
const ob = coalesce(coalesce([], op), { ...op, id: "b", current: 6 }); ok(ob.length === 1 && ob[0].current === 6, "latest chart op per product+range wins");
ok(coalesce(coalesce([], op), { ...op, id: "c", range: 90 }).length === 2, "different range kept");
console.log(`chart-sync: ${n} passed, 0 failed`);
