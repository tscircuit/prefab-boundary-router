# Production-shaped boundary stress benchmark

- Dataset: `production-boundary-problems-v2`
- Seed: `20260729`
- Generated: 2026-07-29T00:01:16.108Z
- Runtime: Bun 1.3.2 on darwin/arm64
- Percentile method: linear interpolation
- Minimum solve target: 100%

Successful-solve percentiles include solved cases only. Attempt percentiles include
both solved and failed cases, measuring the wall-clock cost of every attempt.

| Via ports | Breakout ports | Solved | Solved p50 (ms) | Solved p95 (ms) | Attempt p50 (ms) | Attempt p95 (ms) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 80 | 120 | 20/20 (100.00%) | 150.24 | 906.75 | 150.24 | 906.75 |
| **Overall** | **120** | **20/20 (100.00%)** | **150.24** | **906.75** | **150.24** | **906.75** |
