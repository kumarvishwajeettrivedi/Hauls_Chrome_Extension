// Drive/read the HAULS panel (closed shadow root under #hauls-root) through CDP. Node ids are re-queried on every call (they go stale).
import { poll, sleep } from "./ext.mjs";
const src = f => (typeof f === "function" ? f.toString() : f);

export class Panel {
  constructor(page, cdp) { this.p = page; this.cdp = cdp; }
  static async attach(ctx, page) { return new Panel(page, await ctx.newCDPSession(page)); }
  async rootNode() {
    const c = this.cdp, { root } = await c.send("DOM.getDocument", { depth: 0 });
    const { nodeId } = await c.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#hauls-root" });
    if (!nodeId) throw new Error("no #hauls-root");
    const { node } = await c.send("DOM.describeNode", { nodeId, depth: 1, pierce: true });
    const sr = node.shadowRoots && node.shadowRoots[0]; if (!sr) throw new Error("no shadow root");
    const { object } = await c.send("DOM.resolveNode", { backendNodeId: sr.backendNodeId });
    return (await c.send("DOM.requestNode", { objectId: object.objectId })).nodeId;
  }
  async ids(sel) { return (await this.cdp.send("DOM.querySelectorAll", { nodeId: await this.rootNode(), selector: sel })).nodeIds; }
  async exists() { try { await this.rootNode(); return true; } catch { return false; } }
  async has(sel) { try { return (await this.ids(sel)).length > 0; } catch { return false; } }
  async count(sel) { try { return (await this.ids(sel)).length; } catch { return 0; } }
  // run fn with `this` = i-th match of sel; returns the JSON value
  async run(sel, fn, args = [], i = 0) {
    const n = (await this.ids(sel))[i]; if (!n) throw new Error(`no element ${sel}[${i}]`);
    const { object } = await this.cdp.send("DOM.resolveNode", { nodeId: n });
    const r = await this.cdp.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: src(fn), arguments: args.map(value => ({ value })), returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
    return r.result.value;
  }
  // run fn with `this` = the shadow root (batch reads in one round trip)
  async ev(fn, ...args) {
    const { object } = await this.cdp.send("DOM.resolveNode", { nodeId: await this.rootNode() });
    const r = await this.cdp.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: src(fn), arguments: args.map(value => ({ value })), returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
    return r.result.value;
  }
  waitFor(sel, timeout = 15000) { return poll(() => this.has(sel), timeout, 300); }
  async waitKnob(timeout = 20000) { return this.waitFor(".knob", timeout); }
  click(sel, i = 0) { return this.run(sel, function () { this.scrollIntoView({ block: "center" }); this.click(); }, [], i); }
  text(sel, i = 0) { return this.run(sel, function () { return this.textContent; }, [], i); }
  rect(sel, i = 0) { return this.run(sel, function () { const r = this.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }, [], i); }
  async focus(sel, i = 0) { const n = (await this.ids(sel))[i]; if (!n) throw new Error(`no element ${sel}[${i}]`); await this.cdp.send("DOM.focus", { nodeId: n }); }
  // REAL keystrokes (never set .value)
  async type(sel, text, { i = 0, clear = true, delay = 30 } = {}) {
    await this.focus(sel, i);
    if (clear) { await this.p.keyboard.press("Meta+A"); await this.p.keyboard.press("Backspace"); }
    await this.p.keyboard.type(text, { delay });
  }
  // Real mouse press on an element's centre (pointerdown/up), optionally held for `hold` ms. Needed for the stepper, which listens to pointer events, not click.
  async press(sel, i = 0, hold = 0) { await this.run(sel, function () { this.scrollIntoView({ block: "center" }); }, [], i); const r = await this.rect(sel, i), x = r.x + r.w / 2, y = r.y + r.h / 2;
    await this.p.mouse.move(x, y); await this.p.mouse.down(); if (hold) await sleep(hold); await this.p.mouse.up(); }
  val(sel, i = 0) { return this.run(sel, function () { return this.value; }, [], i); }
  async open() { if (!(await this.has(".w.open"))) { await this.click(".knob"); await this.waitFor(".w.open", 5000); } await sleep(500); }
  async tab(i) { await this.click(".tabs button", i); await sleep(600); }
}

export async function openPage(ctx, url, { wait = true } = {}) {
  const p = await ctx.newPage(); await p.bringToFront();
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  const panel = await Panel.attach(ctx, p);
  if (wait) await panel.waitKnob();
  return { p, panel };
}
