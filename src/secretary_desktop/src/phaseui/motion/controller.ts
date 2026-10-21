import { geometry } from "../geometry";
import {
  el,
  mountFault,
  plan,
  dividerSample,
  type Animate,
  type Sample,
} from "./renderer";
export type MotionMode = "off" | "base" | "extended" | "reduced" | "outline";
export type MotionTarget = {
  kind?:
    | "glyph"
    | "identity"
    | "border"
    | "underline"
    | "input"
    | "send"
    | "divider";
  vertical?: boolean;
  disabled?: boolean;
  label?: boolean;
  adjacent?: boolean;
  source?: string;
};
export type MotionOptions = {
  mode: MotionMode;
  scheme: number;
  freeze: number;
  seed?: number;
  labels: boolean;
  separatorKeys: boolean;
  measure: boolean;
  coverage: boolean;
};
type Effect = {
  animations: Animation[];
  cleanup: (() => void)[];
  timer?: ReturnType<typeof setTimeout>;
  frames: Set<number>;
  interrupted: boolean;
  duration: number;
};
type Registration = {
  options: MotionTarget;
  clean: (() => void)[];
  contact: boolean;
  adjacentAttempt: boolean;
  pressed: boolean;
  near: boolean;
  last: number;
};
export const seeded = (seed: number) => {
  let n = seed >>> 0;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
};
export class MotionController {
  options: MotionOptions = {
    mode: "base",
    scheme: -1,
    freeze: 0,
    labels: true,
    separatorKeys: true,
    measure: false,
    coverage: true,
  };
  readonly active = new Map<HTMLElement, Effect>();
  readonly targets = new Map<HTMLElement, Registration>();
  readonly metrics = {
    construction: [] as number[],
    completed: 0,
    interrupted: 0,
    covered: 0,
  };
  private random = Math.random;
  private globalClean: (() => void)[] = [];
  private reduced = false;
  private lastProbe = 0;
  private frameRequest = 0;
  private divider: HTMLElement | null = null;
  configure(options: Partial<MotionOptions>) {
    this.clearAll();
    this.options = { ...this.options, ...options };
    this.random =
      this.options.seed === undefined ? Math.random : seeded(this.options.seed);
  }
  private listen(
    target: EventTarget,
    name: string,
    fn: EventListener,
    clean: (() => void)[],
  ) {
    target.addEventListener(name, fn);
    clean.push(() => target.removeEventListener(name, fn));
  }
  private install() {
    if (this.globalClean.length) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reduced = media.matches;
    const sync = () => {
      this.reduced = media.matches;
      this.clearAll();
      document.documentElement.classList.toggle("phase-reduced", media.matches);
    };
    sync();
    this.listen(media, "change", sync, this.globalClean);
    this.listen(window, "blur", () => this.clearAll(), this.globalClean);
    this.listen(
      document,
      "visibilitychange",
      () => {
        if (document.hidden) this.clearAll();
      },
      this.globalClean,
    );
    this.listen(window, "resize", () => this.clearDividers(), this.globalClean);
    const scroll = () => this.clearDividers();
    document.addEventListener("scroll", scroll, true);
    this.globalClean.push(() =>
      document.removeEventListener("scroll", scroll, true),
    );
    this.listen(
      document,
      "pointermove",
      ((e: PointerEvent) => this.probe(e.clientX, e.clientY)) as EventListener,
      this.globalClean,
    );
  }
  register(node: HTMLElement, options: MotionTarget = {}) {
    this.install();
    const r: Registration = {
      options,
      clean: [],
      contact: false,
      adjacentAttempt: false,
      pressed: false,
      near: false,
      last: -Infinity,
    };
    this.targets.set(node, r);
    if (options.kind !== "divider") {
      const enter = () => {
        if (!r.contact) {
          r.contact = true;
          this.play(node);
        }
      };
      const leave = () => {
        r.contact = false;
        r.adjacentAttempt = false;
        r.pressed = false;
        node.classList.remove("phase-pressed");
        this.clear(node, true);
      };
      this.listen(
        node,
        "pointerenter",
        () => {
          if (r.options.kind !== "input") enter();
        },
        r.clean,
      );
      this.listen(node, "focusin", enter, r.clean);
      this.listen(node, "pointerleave", leave, r.clean);
      this.listen(node, "focusout", leave, r.clean);
      this.listen(node, "pointercancel", leave, r.clean);
      this.listen(
        node,
        "pointerdown",
        () => {
          if (r.options.kind === "input" || !this.enabled(node)) return;
          r.contact = true;
          if (!this.active.has(node)) this.play(node);
          r.pressed = true;
          node.classList.add("phase-pressed");
          this.adjacent(node);
        },
        r.clean,
      );
      this.listen(
        node,
        "pointerup",
        () => {
          r.pressed = false;
          node.classList.remove("phase-pressed");
        },
        r.clean,
      );
      this.listen(
        node,
        "keydown",
        ((e: KeyboardEvent) => {
          if (r.options.kind === "input" || e.isComposing || e.keyCode === 229)
            return;
          if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
            if (!this.enabled(node)) return;
            r.contact = true;
            if (!this.active.has(node)) this.play(node);
            node.classList.add("phase-pressed");
            this.adjacent(node);
          }
        }) as EventListener,
        r.clean,
      );
      this.listen(
        node,
        "keyup",
        () => node.classList.remove("phase-pressed"),
        r.clean,
      );
      this.listen(
        node,
        "click",
        () => {
          if (r.options.kind !== "input" && !this.active.has(node))
            this.play(node);
        },
        r.clean,
      );
      this.listen(node, "focusin", () => this.adjacent(node), r.clean);
    }
    return {
      update: (next: MotionTarget) => {
        r.options = next;
        if (next.disabled) this.clear(node, true);
      },
      destroy: () => {
        this.clear(node, true);
        r.clean.forEach((f) => f());
        this.targets.delete(node);
        if (!this.targets.size) {
          this.globalClean.splice(0).forEach((f) => f());
          this.clearAll();
        }
      },
    };
  }
  enabled(node: HTMLElement) {
    return (
      node.isConnected &&
      !this.reduced &&
      ["base", "extended"].includes(this.options.mode) &&
      !this.targets.get(node)?.options.disabled &&
      !node.matches(':disabled,[aria-disabled="true"]') &&
      !node.closest("[hidden],[inert]") &&
      !!node.getClientRects().length
    );
  }
  clear(node: HTMLElement, interrupted = false) {
    const e = this.active.get(node);
    if (!e) return;
    this.active.delete(node);
    if (e.timer) clearTimeout(e.timer);
    e.animations.forEach((a) => a.cancel());
    e.cleanup.forEach((f) => f());
    node.classList.remove("phase-active", "phase-pressed");
    if (this.divider === node) this.divider = null;
    if (this.options.measure) {
      if (interrupted) this.metrics.interrupted++;
      else {
        this.metrics.completed++;
        if ([1, 2, 3, 4].every((n) => e.frames.has(n))) this.metrics.covered++;
      }
    }
  }
  clearAll() {
    for (const node of [...this.active.keys()]) this.clear(node, true);
    for (const [node, r] of this.targets) {
      node.classList.remove("phase-pressed");
      r.contact = false;
      r.adjacentAttempt = false;
      r.pressed = false;
      r.near = false;
    }
    if (this.frameRequest) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = 0;
    }
  }
  clearDividers() {
    for (const [n, r] of this.targets)
      if (r.options.kind === "divider") {
        this.clear(n, true);
        r.near = false;
      }
  }
  counts() {
    return {
      effects: this.active.size,
      timers: [...this.active.values()].filter((e) => e.timer).length,
      nodes: [...this.active.keys()].reduce(
        (n, e) =>
          n +
          (e.querySelector("[data-phase-layer]")?.querySelectorAll("*")
            .length ?? 0),
        0,
      ),
      listeners:
        this.globalClean.length +
        [...this.targets.values()].reduce((n, r) => n + r.clean.length, 0),
      targets: this.targets.size,
    };
  }
  private begin(node: HTMLElement, duration: number) {
    this.clear(node, true);
    if (!this.enabled(node)) return;
    const e: Effect = {
      animations: [],
      cleanup: [],
      frames: new Set(),
      interrupted: false,
      duration,
    };
    this.active.set(node, e);
    node.classList.add("phase-active");
    const animate: Animate = (
      target,
      frames,
      span = duration,
      easing = "steps(1,end)",
    ) => {
      const a = target.animate(
        easing === "steps(1,end)"
          ? frames.map((f) => ({ ...f, easing }))
          : frames,
        {
          duration: span,
          easing: easing === "steps(1,end)" ? "linear" : easing,
          fill: "both",
        },
      );
      a.finished.catch(() => {});
      e.animations.push(a);
      if (this.options.freeze) {
        a.pause();
        a.currentTime = span * (((this.options.freeze - 0.5) * 0.8) / 3);
      }
    };
    if (!this.options.freeze)
      e.timer = setTimeout(() => this.clear(node), duration + 30);
    if (this.options.measure && this.options.coverage && !this.frameRequest)
      this.sampleFrames();
    return { e, animate };
  }
  private sampleFrames() {
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = 0;
      for (const [node, e] of this.active) {
        for (const frame of node.querySelectorAll<HTMLElement>(
          "[data-phase-frame],[data-identity-frame],.resolved-display",
        ))
          if (Number(getComputedStyle(frame).opacity) > 0.5)
            e.frames.add(
              Number(
                frame.dataset.phaseFrame ?? frame.dataset.identityFrame ?? 4,
              ),
            );
      }
      if (this.active.size && this.options.measure) this.sampleFrames();
    });
  }
  private layer(node: HTMLElement, e: Effect) {
    const layer = node.querySelector<HTMLElement>("[data-phase-layer]");
    if (!layer) throw Error("PhaseUI requires an owned empty layer");
    e.cleanup.push(() => layer.replaceChildren());
    return layer;
  }
  private svg(layer: HTMLElement, w: number, h: number) {
    const svg = el(document, "svg", {
      viewBox: `0 0 ${w} ${h}`,
      width: w,
      height: h,
      "aria-hidden": "true",
      focusable: "false",
    });
    layer.append(svg);
    return svg;
  }
  play(node: HTMLElement) {
    const r = this.targets.get(node);
    if (!r || !this.enabled(node)) return;
    const started = performance.now();
    const kind = r.options.kind ?? "border";
    if (kind === "divider") {
      this.tryDivider(node);
      return;
    }
    const glyph = node.querySelector<HTMLElement>("[data-glyph]");
    const shape = geometry[glyph?.dataset.glyph ?? "file"];
    const sample = plan(
      { ...shape, name: glyph?.dataset.glyph },
      glyph?.getBoundingClientRect().width ?? 24,
      this.options.scheme,
      this.random,
    );
    const duration =
      kind === "identity"
        ? 180
        : kind === "send"
          ? 420
          : kind === "glyph"
            ? sample.duration
            : 140;
    const effect = this.begin(node, duration);
    if (!effect) return;
    const { e, animate } = effect;
    try {
      const layer = this.layer(node, e);
      if (kind === "identity") this.identity(node, layer, e, animate, 180);
      else if (kind === "glyph" && glyph) {
        const box = glyph.getBoundingClientRect(),
          outer = node.getBoundingClientRect();
        const svg = this.svg(layer, 24, 24);
        Object.assign(svg.style, {
          left: `${box.left - outer.left}px`,
          top: `${box.top - outer.top}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
        });
        const body = glyph.querySelector<SVGElement>("[data-source]")!;
        this.hide(body, e);
        mountFault(
          document,
          svg,
          shape.body,
          sample,
          { width: 24, height: 24 },
          animate,
          sample.kind === 2,
        );
        if (node.matches("[aria-current=page]"))
          this.boundary(node, layer, e, animate, "navigation");
        if (
          this.options.mode === "extended" &&
          this.options.labels &&
          r.options.label
        )
          this.identity(
            node,
            layer,
            e,
            animate,
            sample.duration,
            "[data-nav-label]",
          );
      } else {
        this.boundary(node, layer, e, animate, kind);
        if (kind === "send") this.arrow(node, layer, e, animate);
      }
      if (this.options.measure)
        this.metrics.construction.push(performance.now() - started);
    } catch (error) {
      this.clear(node, true);
      console.error("PhaseUI display restored", error);
    }
  }
  private hide(source: HTMLElement | SVGElement, e: Effect) {
    const old = source.style.visibility;
    source.style.visibility = "hidden";
    e.cleanup.push(() => (source.style.visibility = old));
  }
  private identity(
    node: HTMLElement,
    layer: HTMLElement,
    e: Effect,
    animate: Animate,
    duration: number,
    selector = "[data-identity-source]",
  ) {
    const source = node.querySelector<HTMLElement>(selector);
    if (!source || !source.getClientRects().length) return;
    const box = source.getBoundingClientRect(),
      host = node.getBoundingClientRect(),
      css = getComputedStyle(source);
    if (!box.width || !box.height) return;
    this.hide(source, e);
    const direction = this.random() < 0.5 ? -1 : 1;
    const frame = (index: number) => {
      const group = document.createElement("span");
      group.className = index === 3 ? "resolved-display" : "identity-frame";
      if (index < 3) group.dataset.identityFrame = String(index + 1);
      Object.assign(group.style, {
        left: `${box.left - host.left}px`,
        top: `${box.top - host.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      });
      layer.append(group);
      return group;
    };
    for (let i = 0; i < 4; i++) {
      const group = frame(i);
      for (const part of i === 3
        ? ["base"]
        : node.classList.contains("phase-brand")
          ? ["base", "slice"]
          : ["base", "slice", "echo"]) {
        const copy = document.createElement("span");
        copy.textContent = source.textContent;
        copy.className = "identity-copy";
        for (const prop of [
          "font",
          "letter-spacing",
          "line-height",
          "text-align",
          "writing-mode",
          "text-orientation",
          "text-overflow",
          "white-space",
          "text-shadow",
        ])
          copy.style.setProperty(prop, css.getPropertyValue(prop));
        Object.assign(copy.style, {
          width: "100%",
          height: "100%",
          overflow: "hidden",
          display: css.display,
          alignItems: css.alignItems,
          justifyContent: css.justifyContent,
        });
        if (i < 3) {
          const y = [27, 57, 12][i],
            h = i === 2 ? 8 : 13;
          if (part === "base") {
            const mask = `linear-gradient(to bottom,#000 0%,#000 ${y}%,transparent ${y}%,transparent ${y + h}%,#000 ${y + h}%,#000 100%)`;
            copy.style.maskImage = mask;
            copy.style.setProperty("-webkit-mask-image", mask);
          } else {
            copy.style.clipPath = `inset(${y}% 0 ${100 - y - h}% 0)`;
            copy.style.transform = `translateX(${direction * [1.8, -1.4, 0.8][i] * (part === "echo" ? -0.5 : 1)}px)`;
            if (part === "echo") {
              copy.style.color = "var(--light-blue)";
              copy.style.opacity = ".45";
            }
          }
        }
        group.append(copy);
      }
      animate(
        group,
        [
          { opacity: i === 0 ? 1 : 0, offset: 0 },
          ...(i ? [{ opacity: 1, offset: i === 3 ? 0.8 : (i * 0.8) / 3 }] : []),
          ...(i < 3 ? [{ opacity: 0, offset: ((i + 1) * 0.8) / 3 }] : []),
          { opacity: i === 3 ? 1 : 0, offset: 1 },
        ],
        duration,
      );
    }
  }
  private boundary(
    node: HTMLElement,
    layer: HTMLElement,
    e: Effect,
    animate: Animate,
    kind: string,
  ) {
    const { width: w, height: h } = node.getBoundingClientRect();
    const svg = this.svg(layer, w, h);
    const navigation = kind === "navigation";
    const underline = kind === "underline";
    const send = kind === "send";
    const css = getComputedStyle(node);
    const color = send
      ? css.backgroundColor
      : underline
        ? css.color
        : css.borderTopColor;
    svg.style.color = color;
    node.classList.add(
      underline
        ? "phase-line-fault"
        : send
          ? "phase-surface-fault"
          : "phase-border-fault",
    );
    e.cleanup.push(() =>
      node.classList.remove(
        "phase-line-fault",
        "phase-surface-fault",
        "phase-border-fault",
      ),
    );
    const stroke = kind === "input" && node.matches(":focus-within") ? 2 : 1;
    const inset = stroke / 2;
    const paths = navigation
      ? [`M0 .5H${w} M0 ${h - 0.5}H${w}`]
      : underline
        ? [`M0 ${h - 1}H${w}`]
        : [`M${inset} ${inset}H${w - inset}V${h - inset}H${inset}Z`];
    const sample: Sample = {
      kind: 0,
      duration: send ? 160 : 140,
      band: navigation
        ? { x: w * 0.2, y: -2, width: Math.min(38, w * 0.3), height: 5 }
        : underline
          ? { x: w * 0.2, y: h - 4, width: Math.min(18, w * 0.2), height: 8 }
          : {
              x: send ? -4 : w - 3,
              y: h * 0.3,
              width: send ? w + 8 : 6,
              height: send ? 5 : 16,
            },
      secondBand: navigation
        ? { x: w * 0.55, y: -2, width: Math.min(30, w * 0.25), height: 5 }
        : underline
          ? { x: w * 0.55, y: h - 4, width: Math.min(16, w * 0.2), height: 8 }
          : {
              x: send ? -4 : w - 3,
              y: h * 0.6,
              width: send ? w + 8 : 6,
              height: send ? 4 : 16,
            },
      dx: send ? 2 : underline ? 1 : -1.5,
      dy: underline ? 1 : 0,
      fill: send ? "currentColor" : undefined,
    };
    if (kind === "input") {
      const horizontal = (x: number, y: number, dy: number) => ({
        band: { x: w * x, y: y - 3, width: Math.min(24, w * 0.08), height: 6 },
        dx: 0,
        dy,
      });
      const vertical = (y: number, dx: number) => ({
        band: { x: w - 3, y: h * y, width: 6, height: Math.min(14, h * 0.2) },
        dx,
        dy: 0,
      });
      sample.slices = [horizontal(0.2, 0.5, -1), vertical(0.35, 1)];
      sample.secondSlices = [horizontal(0.62, h - 0.5, 1), vertical(0.65, -1)];
      sample.thirdSlices = [
        horizontal(0.42, 0.5, 1),
        horizontal(0.72, h - 0.5, -1),
      ];
    }
    mountFault(
      document,
      svg,
      paths,
      sample,
      { width: w, height: h },
      animate,
      false,
      stroke,
    );
  }
  private arrow(
    node: HTMLElement,
    layer: HTMLElement,
    e: Effect,
    animate: Animate,
  ) {
    const glyph = node.querySelector<HTMLElement>("[data-glyph]");
    if (!glyph) return;
    const b = glyph.getBoundingClientRect(),
      n = node.getBoundingClientRect();
    const svg = this.svg(layer, 24, 24);
    Object.assign(svg.style, {
      left: `${b.left - n.left}px`,
      top: `${b.top - n.top}px`,
      width: `${b.width}px`,
      height: `${b.height}px`,
      color: "var(--document)",
    });
    this.hide(glyph, e);
    const paths = geometry.send.body.map((d) =>
      el(document, "path", {
        d,
        fill: "none",
        stroke: "currentColor",
        "stroke-width": 1.5,
      }),
    );
    svg.append(...paths);
    animate(
      paths[0],
      [
        { transform: "scaleX(1)", opacity: 1, offset: 0 },
        { transform: "scaleX(1.4)", stroke: "var(--blue)", offset: 0.3 },
        { transform: "scaleX(.4)", opacity: 0.2, offset: 0.55 },
        { transform: "scaleX(.8)", offset: 0.75 },
        { transform: "scaleX(1)", opacity: 1, offset: 1 },
      ],
      420,
      "ease",
    );
    animate(
      paths[1],
      [
        { transform: "translateX(0)", opacity: 1, offset: 0 },
        {
          transform: "translateX(11px)",
          opacity: 1,
          stroke: "var(--blue)",
          offset: 0.35,
        },
        { transform: "translateX(16px)", opacity: 0, offset: 0.5 },
        { transform: "translateX(-8px)", opacity: 0, offset: 0.51 },
        { transform: "translateX(2px)", opacity: 1, offset: 0.75 },
        { transform: "translateX(0)", opacity: 1, offset: 1 },
      ],
      420,
      "ease",
    );
    const trail = el(document, "path", {
      d: "M2 8h6 M2 16h6",
      stroke: "var(--light-blue)",
      "stroke-width": 1,
      fill: "none",
    });
    svg.append(trail);
    animate(
      trail,
      [
        { opacity: 0, offset: 0 },
        { opacity: 0.7, transform: "translateX(5px)", offset: 0.3 },
        { opacity: 0, transform: "translateX(12px)", offset: 0.6 },
        { opacity: 0, offset: 1 },
      ],
      420,
      "ease",
    );
  }
  probe(x: number, y: number) {
    const now = performance.now();
    if (now - this.lastProbe < 50) return;
    this.lastProbe = now;
    const hit = document.elementFromPoint(x, y);
    for (const [n, r] of this.targets) {
      if (r.options.kind !== "divider") continue;
      const b = n.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      const occluded = hit && !n.parentElement?.contains(hit);
      const near =
        !occluded &&
        !!b.width &&
        (r.options.vertical
          ? y >= b.top && y <= b.bottom && Math.abs(x - b.left) <= 7
          : x >= b.left && x <= b.right && Math.abs(y - b.top) <= 7);
      if (near && !r.near) {
        r.near = true;
        this.tryDivider(n);
      } else if (!near && r.near) {
        r.near = false;
        this.clear(n, true);
      }
    }
  }
  private adjacent(node: HTMLElement) {
    const r = this.targets.get(node);
    if (
      r?.adjacentAttempt ||
      !r?.options.adjacent ||
      this.options.mode !== "extended" ||
      !this.options.separatorKeys
    )
      return;
    r.adjacentAttempt = true;
    const line = node
      .closest("nav")
      ?.querySelector<HTMLElement>("[data-nav-divider]");
    if (line) this.tryDivider(line);
  }
  private dividerGap(node: HTMLElement, length: number, vertical: boolean) {
    const selected = vertical
      ? node.parentElement?.querySelector<HTMLElement>(
          '.phase-directory [aria-current="page"]',
        )
      : null;
    if (!selected) return undefined;
    const top = node.getBoundingClientRect().top,
      row = selected.getBoundingClientRect();
    const start = Math.max(0, row.top - top - 2),
      end = Math.min(length, row.bottom - top + 2);
    return start < end ? { start, end } : undefined;
  }
  private dividerPath(node: HTMLElement, length: number, vertical: boolean) {
    const gap = this.dividerGap(node, length, vertical);
    return gap
      ? `M0 .5H${gap.start} M${gap.end} .5H${length}`
      : `M0 .5H${length}`;
  }
  private tryDivider(node: HTMLElement) {
    const r = this.targets.get(node);
    if (
      !r ||
      !this.enabled(node) ||
      performance.now() - r.last < 700 ||
      this.divider
    )
      return;
    r.last = performance.now();
    if (this.random() >= 0.25) return;
    const started = performance.now();
    const effect = this.begin(node, 150);
    if (!effect) return;
    this.divider = node;
    const { e, animate } = effect;
    const box = node.getBoundingClientRect(),
      w = r.options.vertical ? box.height : box.width;
    const layer = this.layer(node, e),
      svg = this.svg(layer, w, 1);
    if (r.options.vertical) {
      svg.style.transformOrigin = "0 0";
      svg.style.transform = "translateX(1px) rotate(90deg)";
    }
    node.classList.add("phase-divider-fault");
    e.cleanup.push(() => node.classList.remove("phase-divider-fault"));
    mountFault(
      document,
      svg,
      [this.dividerPath(node, w, !!r.options.vertical)],
      dividerSample(w, this.dividerGap(node, w, !!r.options.vertical)),
      { width: w, height: 1 },
      animate,
      false,
      1,
    );
    if (this.options.measure)
      this.metrics.construction.push(performance.now() - started);
  }
}
export const motionController = new MotionController();
export const motion = (node: HTMLElement, options: MotionTarget = {}) =>
  motionController.register(node, options);
