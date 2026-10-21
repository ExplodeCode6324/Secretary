# Resource comparison tables

Each cell is the median of three runs, followed by the full run range. CPU100% is one logical core. New WebKit processes are candidates, not exclusive ownership; summed RSS is not physical memory.

## resource

| Scenario | Mode | App CPU mean % | New WebKit candidate CPU mean % | App peak RSS MiB | Candidate peak RSS MiB | rAF p95 ms | Next-callback p95 ms | Schedule max lateness ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| idle | off | 2.10 [2.00–2.51] | 3.40 [3.18–4.24] | 80.97 [80.88–81.52] | 121.91 [120.53–126.45] | 34.00 [34.00–34.00] | N/A | 34.00 [24.00–34.00] |
| idle | base | 2.14 [2.09–2.56] | 3.59 [3.37–4.36] | 80.78 [80.62–81.02] | 126.78 [126.66–127.64] | 34.00 [34.00–34.00] | N/A | 34.00 [33.00–36.00] |
| idle | extended | 2.15 [2.00–2.46] | 3.55 [3.23–4.29] | 80.81 [80.53–81.08] | 127.94 [126.05–129.30] | 34.00 [34.00–34.00] | N/A | 33.00 [33.00–34.00] |
| single | off | 2.80 [2.58–2.89] | 5.25 [4.72–5.28] | 81.20 [80.23–81.34] | 120.75 [120.25–121.31] | 33.00 [33.00–34.00] | 34.00 [33.00–34.00] | 19.00 [18.00–33.00] |
| single | base | 3.78 [3.77–3.86] | 12.09 [11.88–12.18] | 81.97 [81.64–82.02] | 145.70 [144.38–146.47] | 18.00 [18.00–18.00] | 21.00 [21.00–22.00] | 17.00 [4.00–23.00] |
| single | extended | 4.37 [4.36–4.40] | 13.53 [13.30–13.62] | 82.30 [81.77–82.44] | 153.33 [151.67–154.19] | 18.00 [18.00–18.00] | 22.00 [22.00–23.00] | 18.00 [7.00–19.00] |
| navigation | off | 3.00 [2.90–3.02] | 7.28 [7.27–7.29] | 80.92 [80.69–80.97] | 130.06 [129.19–131.25] | 18.00 [18.00–18.00] | 25.00 [25.00–26.00] | 17.00 [17.00–19.00] |
| navigation | base | 3.26 [3.19–3.27] | 16.16 [15.91–16.17] | 80.67 [80.62–80.92] | 196.27 [193.73–196.44] | 18.00 [18.00–18.00] | 33.00 [32.00–33.00] | 18.00 [9.00–23.00] |
| navigation | extended | 3.40 [3.35–3.40] | 17.35 [17.07–17.36] | 80.75 [80.72–80.80] | 221.61 [221.48–223.52] | 18.00 [18.00–18.00] | 36.00 [35.00–37.00] | 17.00 [17.00–18.00] |
| input-scroll | off | 3.61 [3.60–3.64] | 7.13 [7.02–7.18] | 83.56 [83.38–83.69] | 127.42 [127.00–128.20] | 18.00 [18.00–18.00] | 18.00 [18.00–18.00] | 19.00 [9.00–25.00] |
| input-scroll | base | 3.64 [3.61–3.66] | 7.26 [7.25–7.29] | 83.77 [83.66–84.03] | 128.92 [128.81–129.92] | 18.00 [18.00–18.00] | 19.00 [18.00–19.00] | 17.00 [17.00–18.00] |
| input-scroll | extended | 3.66 [3.59–3.71] | 7.21 [7.20–7.28] | 83.84 [83.81–84.02] | 130.08 [129.75–132.25] | 18.00 [18.00–18.00] | 18.00 [18.00–19.00] | 17.00 [6.00–17.00] |
| stream-stress | off | 2.36 [2.36–2.36] | 25.09 [24.90–25.38] | 80.73 [80.73–81.09] | 158.73 [157.56–159.22] | 22.00 [22.00–23.00] | 20.00 [20.00–22.00] | 20.00 [19.00–51.00] |
| stream-stress | base | 2.36 [2.31–2.43] | 26.87 [26.30–27.05] | 80.86 [80.72–80.91] | 176.33 [175.09–178.36] | 22.00 [22.00–23.00] | 23.00 [19.00–23.00] | 30.00 [21.00–44.00] |
| stream-stress | extended | 3.41 [3.38–3.41] | 27.72 [27.60–27.85] | 81.52 [81.17–81.78] | 188.42 [185.64–189.59] | 23.00 [22.00–23.00] | 22.00 [22.00–23.00] | 29.00 [19.00–30.00] |
| bridge-cadence | off | 3.07 [2.80–3.17] | 10.13 [9.41–10.20] | 80.98 [80.67–81.22] | 133.31 [132.27–135.31] | 18.00 [18.00–18.00] | 17.00 [17.00–20.00] | 21.00 [17.00–22.00] |
| bridge-cadence | base | 3.10 [3.01–3.10] | 14.34 [13.94–14.61] | 80.83 [80.81–80.91] | 150.16 [141.36–151.72] | 18.00 [18.00–18.00] | 18.00 [18.00–18.00] | 17.00 [17.00–20.00] |
| bridge-cadence | extended | 4.29 [4.27–4.34] | 16.80 [16.73–16.95] | 81.81 [81.77–82.00] | 165.47 [163.55–165.81] | 18.00 [18.00–18.00] | 23.00 [23.00–24.00] | 20.00 [7.00–21.00] |

## dark-worst

| Scenario | Mode | App CPU mean % | New WebKit candidate CPU mean % | App peak RSS MiB | Candidate peak RSS MiB | rAF p95 ms | Next-callback p95 ms | Schedule max lateness ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| stream-stress | off | 2.33 [2.31–2.36] | 24.13 [24.06–24.28] | 80.52 [80.48–80.61] | 160.08 [154.39–161.38] | 22.00 [22.00–22.00] | 22.00 [21.00–23.00] | 18.00 [18.00–25.00] |
| stream-stress | base | 2.35 [2.26–2.38] | 25.86 [25.82–26.14] | 80.28 [79.77–80.58] | 178.14 [175.25–178.19] | 22.00 [22.00–22.00] | 22.00 [21.00–23.00] | 31.00 [28.00–34.00] |
| stream-stress | extended | 3.42 [3.39–3.46] | 27.20 [27.18–27.21] | 81.53 [81.36–81.59] | 188.00 [186.91–189.34] | 22.00 [22.00–23.00] | 23.00 [22.00–23.00] | 18.00 [18.00–22.00] |

## narrow-worst

| Scenario | Mode | App CPU mean % | New WebKit candidate CPU mean % | App peak RSS MiB | Candidate peak RSS MiB | rAF p95 ms | Next-callback p95 ms | Schedule max lateness ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| stream-stress | off | 2.29 [2.25–2.31] | 24.03 [24.03–24.46] | 80.83 [80.36–81.31] | 160.45 [157.84–160.67] | 23.00 [22.00–23.00] | 24.00 [20.00–25.00] | 25.00 [18.00–26.00] |
| stream-stress | base | 2.35 [2.35–2.36] | 26.27 [26.25–26.29] | 80.80 [80.66–80.89] | 175.22 [174.56–176.41] | 22.00 [22.00–22.00] | 21.00 [20.00–23.00] | 19.00 [17.00–20.00] |
| stream-stress | extended | 2.40 [2.40–2.44] | 26.39 [26.15–26.78] | 81.17 [80.95–81.25] | 176.00 [174.44–176.41] | 22.00 [22.00–23.00] | 22.00 [22.00–23.00] | 20.00 [18.00–33.00] |

## idle-control

| Scenario | Mode | App CPU mean % | New WebKit candidate CPU mean % | App peak RSS MiB | Candidate peak RSS MiB | rAF p95 ms | Next-callback p95 ms | Schedule max lateness ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| idle | off | 0.00 [0.00–0.00] | 0.84 [0.79–0.96] | 80.58 [80.19–80.59] | 123.72 [123.19–125.06] | N/A | N/A | N/A |
| idle | base | 0.02 [0.00–0.02] | 0.98 [0.94–1.13] | 80.38 [80.02–80.55] | 124.67 [124.14–124.95] | N/A | N/A | N/A |
| idle | extended | 0.02 [0.00–0.02] | 1.04 [0.89–1.11] | 80.28 [80.23–80.67] | 125.30 [123.22–126.95] | N/A | N/A | N/A |

## Absolute mode deltas vs OFF

Differences of three-run medians in the main cohort. These are percentage points of one CPU core and MiB, not relative percentages.

| Scenario | Mode | App CPU delta | Candidate CPU delta | App peak RSS delta MiB | Candidate peak RSS delta MiB |
|---|---|---:|---:|---:|---:|
| idle | base | +0.03 | +0.18 | -0.19 | +4.88 |
| idle | extended | +0.05 | +0.15 | -0.16 | +6.03 |
| single | base | +0.99 | +6.84 | +0.77 | +24.95 |
| single | extended | +1.58 | +8.28 | +1.09 | +32.58 |
| navigation | base | +0.25 | +8.88 | -0.25 | +66.20 |
| navigation | extended | +0.39 | +10.07 | -0.17 | +91.55 |
| input-scroll | base | +0.03 | +0.13 | +0.20 | +1.50 |
| input-scroll | extended | +0.04 | +0.08 | +0.28 | +2.66 |
| stream-stress | base | +0.00 | +1.78 | +0.12 | +17.59 |
| stream-stress | extended | +1.05 | +2.63 | +0.78 | +29.69 |
| bridge-cadence | base | +0.03 | +4.21 | -0.16 | +16.84 |
| bridge-cadence | extended | +1.22 | +6.67 | +0.83 | +32.16 |

## Logical frame coverage

These are separate diagnostic runs, not physical presentation measurements. OFF has no eligible effect coverage.

| Scenario | Mode | Completed | Covered | Interrupted | Construction max ms |
|---|---|---:|---:|---:|---:|
| single | off | 0 | 0 | 0 | 0 |
| single | base | 120 | 120 | 1 | 7 |
| single | extended | 120 | 120 | 1 | 9 |
| navigation | off | 0 | 0 | 0 | 0 |
| navigation | base | 121 | 121 | 240 | 4 |
| navigation | extended | 131 | 131 | 240 | 5 |

## Recovery retained RSS

Difference between final recovery and pre-active median RSS; this is retained process RSS, not an allocation-leak attribution. Counts are checked separately.

| Scenario | Mode | App recovery−baseline MiB | Candidate recovery−baseline MiB |
|---|---|---:|---:|
| idle | off | -4.17 [-13.38–0.03] | -10.23 [-24.80–8.59] |
| idle | base | -0.03 [-0.17–-0.02] | 8.69 [8.58–9.16] |
| idle | extended | -0.06 [-0.34–0.03] | 9.22 [7.97–10.69] |
| single | off | -0.33 [-0.38–-0.33] | 8.08 [7.69–8.49] |
| single | base | 1.17 [1.16–1.20] | 31.69 [31.02–32.78] |
| single | extended | 1.33 [1.33–1.50] | 38.27 [37.93–38.39] |
| navigation | off | -0.19 [-0.20–-0.19] | 17.47 [17.36–18.19] |
| navigation | base | -0.14 [-0.30–-0.14] | 81.26 [80.59–82.16] |
| navigation | extended | -0.09 [-0.47–0.00] | 108.25 [106.56–109.70] |
| input-scroll | off | 2.72 [2.62–3.00] | 14.41 [13.89–14.68] |
| input-scroll | base | 2.61 [2.52–2.77] | 15.58 [15.34–16.97] |
| input-scroll | extended | 2.59 [2.58–2.77] | 16.77 [15.64–19.34] |
| stream-stress | off | -0.28 [-0.62–-0.22] | 43.78 [42.77–44.34] |
| stream-stress | base | -0.27 [-0.31–-0.27] | 59.52 [58.77–62.30] |
| stream-stress | extended | 0.88 [0.84–0.97] | 73.21 [69.98–74.98] |
| bridge-cadence | off | -0.25 [-0.30–-0.23] | 21.25 [19.70–22.64] |
| bridge-cadence | base | -0.28 [-11.94–-0.22] | 36.61 [26.49–37.03] |
| bridge-cadence | extended | 0.91 [0.91–0.92] | 51.64 [49.11–52.13] |
