# Double-breakout production boundary stress benchmark

- Dataset: `production-double-breakout-boundary-problems-v1`
- Seed: `20260730`
- Generated: 2026-07-29T02:28:48.359Z
- Runtime: Bun 1.3.2 on darwin/arm64
- Percentile method: linear interpolation
- Minimum solve target: 75%

Successful-solve percentiles include solved cases only. Attempt percentiles include
both solved and failed cases, measuring the wall-clock cost of every attempt.

| Via ports | Breakout ports | Solved | Solved p50 (ms) | Solved p95 (ms) | Attempt p50 (ms) | Attempt p95 (ms) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 80 | 240 | 15/20 (75.00%) | 182.39 | 1811.25 | 243.39 | 4360.40 |
| **Overall** | **240** | **15/20 (75.00%)** | **182.39** | **1811.25** | **243.39** | **4360.40** |
