# Production-shaped boundary stress benchmark

- Dataset: `production-boundary-problems-v2`
- Seed: `20260729`
- Generated: 2026-07-28T23:41:03.950Z
- Runtime: Bun 1.3.2 on darwin/arm64
- Percentile method: linear interpolation
- Minimum solve target: 50%

Successful-solve percentiles include solved cases only. Attempt percentiles include
both solved and failed cases, measuring the wall-clock cost of every attempt.

| Via ports | Breakout ports | Solved | Solved p50 (ms) | Solved p95 (ms) | Attempt p50 (ms) | Attempt p95 (ms) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 80 | 120 | 15/20 (75.00%) | 145.26 | 480.20 | 153.26 | 777.04 |
| **Overall** | **120** | **15/20 (75.00%)** | **145.26** | **480.20** | **153.26** | **777.04** |
