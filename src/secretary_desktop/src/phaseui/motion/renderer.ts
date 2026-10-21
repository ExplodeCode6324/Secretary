// Port of frozen signal-motion.js:5–311, with typed boundaries. Same masks and discrete frames.
import type { Shape } from "../geometry";
export type Bounds = { width: number; height: number };
export type Band = { x: number; y: number; width: number; height: number };
export type Slice = { band: Band; dx: number; dy: number };
export type Sample = {
  slices?: Slice[];
  secondSlices?: Slice[];
  thirdSlices?: Slice[];
  kind: number;
  duration: number;
  band: Band;
  secondBand?: Band;
  thirdBand?: Band;
  dx: number;
  dy?: number;
  dropout?: { d: string; start: number; length: number };
  residueWidth?: number;
  fill?: string;
  frameCount?: number;
};
export type Animate = (
  node: SVGElement | HTMLElement,
  frames: Keyframe[],
  duration?: number,
  easing?: string,
) => void;
const NS = "http://www.w3.org/2000/svg";
let serial = 0;
export function plan(
  shape: Shape,
  size: number,
  scheme = -1,
  random = Math.random,
): Sample {
  const fixed = scheme >= 0;
  const kind = fixed ? Math.min(3, scheme) : Math.floor(random() * 3);
  const variation = fixed ? 0.5 : random();
  const direction = fixed ? 1 : random() < 0.5 ? -1 : 1;
  const small = size <= 18;
  const region =
    shape.regions[fixed ? 0 : Math.floor(random() * shape.regions.length)];
  const bands: Record<string, number> = {
    attention: 12,
    search: 10,
    tasks: 11,
    send: 11,
    chat: 10,
    memory: 12,
    file: 10,
    settings: 8,
    plus: 10,
    check: 12,
    arrow: 11,
    motion: 10,
    close: 10,
  };
  return {
    kind,
    duration: small ? 140 : [160, 180, 200, 0][kind],
    band: {
      x: -4,
      y:
        (bands[shape.name ?? ""] || 11) +
        (fixed ? 0 : Math.floor(variation * 3) - 1),
      width: 32,
      height: small ? 3 : 4,
    },
    dx: (direction * (small ? 1 : 2.4) * 24) / Math.max(size, 1),
    dropout: {
      d: shape.body[region[0]],
      start: region[1],
      length: small ? 10 : 12 + Math.round(variation * 6),
    },
    residueWidth: fixed ? 1 : variation < 0.5 ? 0.7 : 1.8,
  };
}
export function el(
  document: Document,
  tag: string,
  attrs: Record<string, string | number> = {},
): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, String(value));
  return node;
}
// The only full source image is hidden by the caller. All visible copies are clipped/masked.
function mountFaultFrame(
  document: Document,
  layer: SVGElement,
  paths: string[],
  sample: Sample,
  bounds: Bounds,
  animate: Animate,
  residue = false,
  strokeWidth = 1.5,
) {
  const id = `phase-${++serial}`;
  const defs = el(document, "defs");
  layer.append(defs);
  const maskAttrs = {
    maskUnits: "userSpaceOnUse",
    maskContentUnits: "userSpaceOnUse",
    x: -8,
    y: -8,
    width: bounds.width + 16,
    height: bounds.height + 16,
    style: "mask-type:luminance",
  };
  const makeMask = (suffix: string) => {
    const m = el(document, "mask", { ...maskAttrs, id: id + suffix });
    m.append(
      el(document, "rect", {
        x: -8,
        y: -8,
        width: bounds.width + 16,
        height: bounds.height + 16,
        fill: "white",
        stroke: "none",
      }),
    );
    defs.append(m);
    return m;
  };
  const baseMask = makeMask("-base");
  const hasSlice = sample.kind === 0 || sample.kind === 2;
  const hasDropout = sample.kind === 1 || sample.kind === 2;
  const draw = (parent: SVGElement) =>
    paths.forEach((d) =>
      parent.append(
        el(document, "path", {
          d,
          fill: sample.fill || "none",
          stroke: "currentColor",
          "stroke-width": strokeWidth,
          "stroke-linejoin": "round",
          "stroke-linecap": "round",
        }),
      ),
    );
  const addDropout = (mask: SVGElement) => {
    const hole = el(document, "path", {
      d: sample.dropout!.d,
      fill: "none",
      stroke: "black",
      "stroke-width": strokeWidth + 1.5,
      pathLength: 100,
      "stroke-dasharray": `0 ${sample.dropout!.start} ${sample.dropout!.length} 100`,
      "stroke-linecap": "butt",
      class: "dropout-hole",
    });
    mask.append(hole);
    animate(
      hole,
      [
        { opacity: 1, offset: 0 },
        { opacity: 0, offset: 0.45 },
        { opacity: 1, offset: 0.6 },
        { opacity: 0, offset: 1 },
      ],
      sample.duration,
    );
  };
  if (hasDropout) addDropout(baseMask);
  const base = el(document, "g", {
    mask: `url(#${id}-base)`,
    class: "rendered-base",
  });
  draw(base);
  layer.append(base);
  if (hasSlice) {
    const slices = sample.slices ?? [
      { band: sample.band, dx: sample.dx, dy: sample.dy || 0 },
    ];
    for (const [index, slice] of slices.entries()) {
      const sliceId = `${id}-slice-${index}`;
      const cut = el(document, "rect", {
        ...slice.band,
        fill: "black",
        stroke: "none",
        class: "source-gap",
      });
      baseMask.append(cut);
      const clip = el(document, "clipPath", {
        id: sliceId,
        clipPathUnits: "userSpaceOnUse",
      });
      clip.append(el(document, "rect", { ...slice.band }));
      defs.append(clip);
      const moved = el(document, "g", { class: "displaced-slice" });
      const cropped = el(document, "g", { "clip-path": `url(#${sliceId})` });
      if (hasDropout) {
        const dropMask = makeMask(`-drop-${index}`);
        addDropout(dropMask);
        cropped.setAttribute("mask", `url(#${id}-drop-${index})`);
      }
      draw(cropped);
      moved.append(cropped);
      layer.append(moved);
      const dx = slice.dx,
        dy = slice.dy;
      const frames = [
        { transform: `translate(${dx}px,${dy}px)`, offset: 0 },
        { transform: "translate(0px,0px)", offset: 0.48 },
        { transform: `translate(${dx * 0.5}px,${dy}px)`, offset: 0.64 },
        { transform: "translate(0px,0px)", offset: 1 },
      ];
      animate(moved, frames, sample.duration);
      if (residue) {
        const echo = el(document, "g", {
          "clip-path": `url(#${sliceId})`,
          class: "signal-residue",
          color: "var(--light-blue)",
        });
        paths.forEach((d) =>
          echo.append(
            el(document, "path", {
              d,
              fill: "none",
              stroke: "currentColor",
              "stroke-width": sample.residueWidth ?? 1,
            }),
          ),
        );
        layer.append(echo);
        animate(
          echo,
          [
            {
              opacity: 0.45,
              transform: `translate(${-dx / 2}px,0px)`,
              offset: 0,
            },
            { opacity: 0, transform: "translate(0px,0px)", offset: 0.5 },
            { opacity: 0, offset: 1 },
          ],
          sample.duration,
        );
      }
    }
  }
}
export function secondFrame(sample: Sample, bounds: Bounds): Sample {
  return {
    ...sample,
    slices: sample.secondSlices,
    band: sample.secondBand || {
      ...sample.band,
      y: Math.min(
        bounds.height - sample.band.height - 1,
        sample.band.y + sample.band.height + 2,
      ),
    },
    dx: -sample.dx * 0.75,
    dy: -(sample.dy || 0),
    dropout: sample.dropout
      ? {
          ...sample.dropout,
          start: (sample.dropout!.start + 29) % (100 - sample.dropout!.length),
        }
      : undefined,
  };
}
export function thirdFrame(sample: Sample, bounds: Bounds): Sample {
  return {
    ...sample,
    slices: sample.thirdSlices,
    band: sample.thirdBand || {
      ...sample.band,
      y: Math.max(0, sample.band.y - sample.band.height - 2),
      height: Math.max(2, sample.band.height * 0.7),
    },
    dx: sample.dx * 0.5,
    dy: 0,
    dropout: sample.dropout
      ? {
          ...sample.dropout,
          start: (sample.dropout!.start + 57) % (100 - sample.dropout!.length),
        }
      : undefined,
  };
}
export function mountFault(
  document: Document,
  layer: SVGElement,
  paths: string[],
  sample: Sample,
  bounds: Bounds,
  animate: Animate,
  residue = false,
  strokeWidth = 1.5,
) {
  const samples = [sample, secondFrame(sample, bounds)];
  if (sample.frameCount !== 2) samples.push(thirdFrame(sample, bounds));
  const step = 0.8 / samples.length;
  samples.forEach((frame, index) => {
    const group = el(document, "g", {
      "data-phase-frame": index + 1,
      class: "fault-frame",
    });
    group.style.opacity = index === 0 ? "1" : "0";
    layer.append(group);
    // Each logical frame is a different static reconstruction, not an eased return of frame one.
    mountFaultFrame(
      document,
      group,
      paths,
      frame,
      bounds,
      (node, frames) => {
        for (const [key, value] of Object.entries(frames[0]))
          if (key !== "offset") node.style.setProperty(key, String(value));
      },
      residue,
      strokeWidth,
    );
    animate(
      group,
      [
        { opacity: index === 0 ? 1 : 0, offset: 0 },
        ...(index ? [{ opacity: 1, offset: index * step }] : []),
        { opacity: 0, offset: (index + 1) * step },
        { opacity: 0, offset: 1 },
      ],
      sample.duration,
    );
  });
  const resolved = el(document, "g", { class: "resolved-display" });
  resolved.style.opacity = "0";
  paths.forEach((d) =>
    resolved.append(
      el(document, "path", {
        d,
        fill: sample.fill || "none",
        stroke: "currentColor",
        "stroke-width": strokeWidth,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    ),
  );
  layer.append(resolved);
  animate(
    resolved,
    [
      { opacity: 0, offset: 0 },
      { opacity: 1, offset: 0.8 },
      { opacity: 1, offset: 1 },
    ],
    sample.duration,
  );
}

// Every displaced segment has a matching source gap in each discrete frame.
export function dividerSample(
  length: number,
  gap?: { start: number; end: number },
): Sample {
  const visibleLength = length - (gap ? gap.end - gap.start : 0);
  const width = Math.min(14, visibleLength * 0.035);
  const position = (fraction: number) => {
    if (!gap) return length * fraction;
    const left = Math.max(0, gap.start - width);
    const right = Math.max(0, length - gap.end - width);
    const x = fraction * (left + right);
    return x < left ? x : gap.end + x - left;
  };
  const frame = (positions: number[], signs: number[]): Slice[] =>
    positions.map((x, i) => ({
      band: { x: position(x), y: -3, width, height: 7 },
      dx: 0,
      dy: signs[i] * 1.5,
    }));
  return {
    kind: 0,
    duration: 150,
    band: { x: 0, y: -3, width, height: 7 },
    dx: 0,
    slices: frame([0.22, 0.62], [1, -1]),
    secondSlices: frame([0.42, 0.76], [-1, 1]),
    thirdSlices: frame([0.15, 0.55, 0.61], [1, -1, 1]),
  };
}
