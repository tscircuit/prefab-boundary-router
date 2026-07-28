# Random boundary stress benchmark

- Dataset: `random-boundary-problems-v1`
- Seed: `20260728`
- Generated: 2026-07-28T22:44:55.259Z
- Runtime: Bun 1.3.2 on darwin/arm64
- Percentile method: linear interpolation

Successful-solve percentiles include solved cases only. Attempt percentiles include
both solved and failed cases, measuring the wall-clock cost of every attempt.

| Via ports | Solved | Solved p50 (ms) | Solved p95 (ms) | Attempt p50 (ms) | Attempt p95 (ms) |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | 2/4 (50.00%) | 1.07 | 1.62 | 2.20 | 4.32 |
| 40 | 4/4 (100.00%) | 1.62 | 2.15 | 1.62 | 2.15 |
| 60 | 4/4 (100.00%) | 3.01 | 9.48 | 3.01 | 9.48 |
| 80 | 4/4 (100.00%) | 3.13 | 13.39 | 3.13 | 13.39 |
| 100 | 4/4 (100.00%) | 9.63 | 16.81 | 9.63 | 16.81 |
| **Overall** | **18/20 (90.00%)** | **2.99** | **15.55** | **2.99** | **15.32** |
