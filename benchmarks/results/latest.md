# Random boundary stress benchmark

- Dataset: `random-boundary-problems-v2`
- Seed: `20260728`
- Generated: 2026-07-28T22:51:22.802Z
- Runtime: Bun 1.3.2 on darwin/arm64
- Percentile method: linear interpolation

Successful-solve percentiles include solved cases only. Attempt percentiles include
both solved and failed cases, measuring the wall-clock cost of every attempt.

| Via ports | Breakout ports | Solved | Solved p50 (ms) | Solved p95 (ms) | Attempt p50 (ms) | Attempt p95 (ms) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | 8 | 3/4 (75.00%) | 0.88 | 1.82 | 1.40 | 5.12 |
| 40 | 16 | 2/4 (50.00%) | 6.41 | 8.52 | 11.49 | 22.35 |
| 60 | 24 | 0/4 (0.00%) | n/a | n/a | 102.65 | 188.31 |
| 80 | 32 | 0/4 (0.00%) | n/a | n/a | 217.69 | 944.56 |
| 100 | 40 | 0/4 (0.00%) | n/a | n/a | 360.17 | 821.48 |
| **Overall** | **8–40** | **5/20 (25.00%)** | **1.92** | **7.81** | **102.65** | **910.16** |
