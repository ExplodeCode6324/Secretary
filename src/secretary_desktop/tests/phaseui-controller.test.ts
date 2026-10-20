import { test } from "node:test";
import assert from "node:assert/strict";
import { MotionController } from "../src/phaseui/motion/controller";
class Element extends EventTarget {
  attrs: Record<string, string> = {};
  children: Element[] = [];
  parentElement: Element | null = null;
  dataset: Record<string, string> = {};
  isConnected = true;
  disabled = false;
  styles: Record<string, string> = {};
  style: any = { setProperty: (k: string, v: string) => (this.styles[k] = v) };
  classes = new Set<string>();
  classList = {
    add: (...xs: string[]) => xs.forEach((x) => this.classes.add(x)),
    remove: (...xs: string[]) => xs.forEach((x) => this.classes.delete(x)),
    toggle: (x: string, on: boolean) =>
      on ? this.classes.add(x) : this.classes.delete(x),
  };
  animations: { cancelled: boolean }[] = [];
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
    if (k.startsWith("data-"))
      this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] =
        v;
  }
  append(...nodes: Element[]) {
    for (const n of nodes) {
      n.parentElement = this;
      this.children.push(n);
    }
  }
  replaceChildren() {
    this.children = [];
  }
  matches() {
    return this.disabled;
  }
  closest() {
    return null;
  }
  getClientRects() {
    return [this.getBoundingClientRect()];
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 100, height: 30, right: 100, bottom: 30 };
  }
  querySelector(selector: string): Element | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  querySelectorAll(selector: string): Element[] {
    return this.children.flatMap((n) => [
      ...(selector === "*" ||
      (selector === "[data-phase-layer]" && "data-phase-layer" in n.attrs)
        ? [n]
        : []),
      ...n.querySelectorAll(selector),
    ]);
  }
  animate() {
    const a = {
      cancelled: false,
      cancel() {
        this.cancelled = true;
      },
      pause() {},
      currentTime: 0,
      finished: Promise.resolve(),
    };
    this.animations.push(a);
    return a;
  }
}
function setup() {
  const media = Object.assign(new EventTarget(), { matches: false });
  const document = Object.assign(new EventTarget(), {
    documentElement: new Element(),
    hidden: false,
    createElementNS: () => new Element(),
    createElement: () => new Element(),
  });
  const window = Object.assign(new EventTarget(), { matchMedia: () => media });
  const saved = new Map(
    ["window", "document", "getComputedStyle"].map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ]),
  );
  Object.defineProperties(globalThis, {
    window: { value: window, configurable: true },
    document: { value: document, configurable: true },
    getComputedStyle: {
      value: () => ({
        backgroundColor: "#fff",
        borderTopColor: "#333",
        color: "#333",
      }),
      configurable: true,
    },
  });
  const node = new Element(),
    layer = new Element();
  layer.setAttribute("data-phase-layer", "");
  node.append(layer);
  const cleanup = () => {
    for (const [k, v] of saved) {
      if (v) Object.defineProperty(globalThis, k, v);
      else Reflect.deleteProperty(globalThis, k);
    }
  };
  return { media, window, document, node, layer, cleanup };
}
test("contact coalesces; disable, blur, reduced and destruction restore owned resources", () => {
  const f = setup();
  const c = new MotionController();
  const node = f.node as unknown as HTMLElement;
  try {
    const binding = c.register(node, { kind: "border" });
    const baseline = c.counts();
    f.node.dispatchEvent(new Event("pointerenter"));
    const effect = c.active.get(node);
    assert(effect);
    assert.equal(c.counts().effects, 1);
    assert(c.counts().nodes > 0);
    assert.equal(c.counts().timers, 1);
    f.node.dispatchEvent(new Event("focusin"));
    f.node.dispatchEvent(new Event("pointerdown"));
    assert.equal(c.active.get(node), effect);
    c.clear(node); // Completed hover, pointer remains over the same target.
    f.node.dispatchEvent(new Event("pointerdown"));
    assert(c.active.has(node), "press replays after hover completion");
    c.clear(node);
    f.node.dispatchEvent(
      Object.assign(new Event("keydown"), { key: "Enter", repeat: false }),
    );
    assert(
      c.active.has(node),
      "keyboard activation replays after contact completion",
    );
    c.clear(node);
    f.node.dispatchEvent(new Event("click"));
    assert(c.active.has(node), "click recovers an expired activation");
    f.document.hidden = true;
    f.document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(c.active.size, 0);
    f.document.hidden = false;
    c.play(node);
    binding.update({ kind: "border", disabled: true });
    assert.equal(c.counts().effects, 0);
    assert.equal(c.counts().nodes, 0);
    assert.equal(c.counts().timers, 0);
    binding.update({ kind: "border" });
    c.play(node);
    f.window.dispatchEvent(new Event("blur"));
    assert.equal(c.counts().effects, 0);
    c.play(node);
    f.media.matches = true;
    f.media.dispatchEvent(new Event("change"));
    assert.equal(c.counts().effects, 0);
    c.play(node);
    assert.equal(c.counts().effects, 0);
    f.media.matches = false;
    f.media.dispatchEvent(new Event("change"));
    assert.equal(c.counts().effects, 0, "no replay after reduced motion");
    c.play(node);
    c.configure({ mode: "off" });
    assert.equal(c.counts().nodes, 0);
    c.play(node);
    assert.equal(c.counts().effects, 0);
    assert.equal(c.counts().listeners, baseline.listeners);
    binding.destroy();
    assert.deepEqual(c.counts(), {
      effects: 0,
      timers: 0,
      nodes: 0,
      listeners: 0,
      targets: 0,
    });
  } finally {
    c.clearAll();
    f.cleanup();
  }
});
