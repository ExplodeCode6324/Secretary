// Geometry from frozen PhaseUI v1.0.0 / 8cdb921. Auxiliary paths are not source bodies.
export type Shape = { body: string[]; regions: number[][]; name?: string };
export const geometry: Record<string, Shape> = {
  collapseRail: {
    body: ["M4 4h16v16H4z", "M15 4v16", "M8 8l4 4-4 4"],
    regions: [
      [0, 10, 20],
      [1, 20, 35],
      [2, 10, 40],
    ],
  },
  expandRail: {
    body: ["M4 4h16v16H4z", "M15 4v16", "M11 8l-4 4 4 4"],
    regions: [
      [0, 10, 20],
      [1, 20, 35],
      [2, 10, 40],
    ],
  },
  attention: {
    body: ["M12 3a6 6 0 0 0-6 6v6l-2 3h16l-2-3V9a6 6 0 0 0-6-6", "M10 21h4"],
    regions: [
      [0, 12, 19],
      [0, 39, 20],
      [0, 65, 16],
      [1, 5, 65],
    ],
  },
  search: {
    body: ["M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14", "M15 15l6 6"],
    regions: [
      [0, 10, 20],
      [0, 42, 18],
      [0, 70, 22],
      [1, 15, 55],
    ],
  },
  send: {
    body: ["M4 12h15", "M13 5l7 7-7 7"],
    regions: [
      [0, 10, 35],
      [1, 7, 25],
      [1, 56, 28],
      [0, 54, 28],
    ],
  },
  chat: {
    body: ["M4 4h16v12H10l-5 4v-4H4z", "M8 8h8", "M8 11h5"],
    regions: [
      [0, 15, 19],
      [0, 40, 18],
      [0, 66, 18],
      [1, 20, 45],
    ],
  },
  tasks: {
    body: ["M8 5H5v16h14V5h-3", "M9 3h6v4H9z", "M8 13l3 3 5-6"],
    regions: [
      [0, 5, 18],
      [0, 40, 20],
      [1, 10, 25],
      [2, 40, 35],
    ],
  },
  memory: {
    body: ["M5 3h14v18H5z", "M8 3v18", "M11 8h5 M11 12h5 M11 16h3"],
    regions: [
      [0, 10, 16],
      [0, 43, 20],
      [1, 20, 32],
      [0, 72, 17],
    ],
  },
  file: {
    body: ["M6 3h8l5 5v13H6z", "M14 3v6h5", "M9 13h7 M9 17h5"],
    regions: [
      [0, 10, 17],
      [0, 45, 20],
      [1, 5, 35],
      [0, 76, 15],
    ],
  },
  settings: {
    body: ["M4 7h16 M4 17h16", "M8 4v6", "M16 14v6"],
    regions: [
      [0, 3, 16],
      [0, 58, 20],
      [1, 10, 45],
      [2, 20, 45],
    ],
  },
  plus: {
    body: ["M12 4v16", "M4 12h16"],
    regions: [
      [0, 5, 28],
      [1, 55, 30],
      [0, 58, 25],
      [1, 5, 28],
    ],
  },
  check: {
    body: ["M5 12l4 4L19 6"],
    regions: [
      [0, 3, 23],
      [0, 40, 20],
      [0, 64, 26],
      [0, 25, 24],
    ],
  },
  arrow: {
    body: ["M5 12h14", "M14 7l5 5-5 5"],
    regions: [
      [0, 5, 32],
      [1, 5, 25],
      [1, 57, 30],
      [0, 55, 30],
    ],
  },
  motion: {
    body: ["M4 6h12v12H4z", "M8 3h12v12"],
    regions: [
      [0, 5, 18],
      [1, 8, 22],
      [0, 55, 20],
      [1, 65, 25],
    ],
  },
  close: {
    body: ["M5 5l14 14", "M19 5L5 19"],
    regions: [
      [0, 5, 28],
      [1, 58, 28],
      [0, 60, 25],
      [1, 8, 28],
    ],
  },
};
