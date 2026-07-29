# Prefab Boundary Router

`@tscircuit/prefab-boundary-router` is a standalone TypeScript solver built
around `@tscircuit/solver-utils`.

[Browse and debug the example problems in the Cosmos preview.](https://prefab-boundary-router.vercel.app)

It connects nets through the continuous region between two rectangular
boundaries:

- breakout ports sit on the inner rectangle and carry a `netId`;
- via ports sit on the encompassing rectangle and form reciprocal pairs;
- entering one via port permits an instantaneous jump to its paired port;
- trace segments may not enter the breakout rectangle's strict interior;
- trace segments from different nets may not intersect;
- routes in the same net may merge.

All identifier fields are role-prefixed: `portId`, `pairedPortId`, `netId`,
`nodeId`, and `routeId`. The API does not expose a bare `id` property.

## Pipeline

`BoundaryRoutingPipelineSolver` is a three-stage `BasePipelineSolver`:

1. `PrepareBoundaryRoutingProblemSolver` validates the geometry and reduces
   each multi-terminal net to deterministic two-terminal demands.
2. `ViaBoundaryAssignmentSolver` solves only the discrete problem. Same-side
   demands stay local; other demands claim reciprocal prefab-via pairs. A pair
   can be reused by its owning net but cannot be assigned to a different net.
3. `HighDensityPhysicalRoutingSolver` turns those assignments into concrete
   point pairs and routes their copper with
   `@tscircuit/high-density-b01`. Assignment never treats a logical via jump as
   physical copper.

Each B01 input contains only the bounding box of the point pair, expanded by
`options.highDensityRoutingMargin` (3 mm by default) and clamped to
`viaBoundary`. Long boundary runs are split into local handoffs, keeping every
B01 routing window within its 15×15 mm limit instead of rasterizing the full
board.

## Installation

The package is published to GitHub Packages and can be installed through
tscircuit's JSCDN without configuring npm authentication:

```sh
bun add https://jscdn.tscircuit.com/@tscircuit/prefab-boundary-router/latest.tgz
```

## Usage

```ts
import {
  BoundaryRoutingPipelineSolver,
  type BoundaryRoutingProblem,
} from "@tscircuit/prefab-boundary-router"

const problem: BoundaryRoutingProblem = {
  viaBoundary: {
    minX: 0,
    minY: 0,
    maxX: 10,
    maxY: 10,
    ports: [
      { portId: "vl", pairedPortId: "vr", x: 0, y: 5 },
      { portId: "vr", pairedPortId: "vl", x: 10, y: 5 },
    ],
  },
  breakoutBoundary: {
    minX: 2,
    minY: 2,
    maxX: 8,
    maxY: 8,
    ports: [
      { portId: "p1", netId: "signal", x: 2, y: 5 },
      { portId: "p2", netId: "signal", x: 8, y: 5 },
    ],
  },
  options: {
    viaJumpCost: 0.25,
    highDensityRoutingMargin: 3,
  },
}

const solver = new BoundaryRoutingPipelineSolver(problem)
solver.solve()

if (solver.failed) throw new Error(solver.error ?? "routing failed")
console.log(solver.getOutput())
```

## Geometry validation

Every pipeline result is validated before it is marked solved, including
results produced by the legacy fallback. Different-net copper is checked for
same-layer trace crossings and clearance violations, trace-to-via conflicts,
and via-to-via conflicts.

The validator is also available for callers that load or transform a solution:

```ts
import {
  findDifferentNetGeometryViolations,
  validateBoundaryRoutingSolutionGeometry,
} from "@tscircuit/prefab-boundary-router"

const violations = findDifferentNetGeometryViolations(solution)
validateBoundaryRoutingSolutionGeometry(solution) // throws when invalid
```

Crossings between different layers and intersections between branches of the
same net are allowed. Pass `{ clearance: 0.15 }` to require additional spacing
beyond the physical trace and via dimensions.

Run the project with:

```sh
bun install
bun run test
bun run build
bun run build:site
```

## Stress benchmark

The checked-in `random-boundary-problems-v2` dataset contains 20 deterministic
random problems: four cases each at five increasing problem sizes. Via ports
scale from 20 to 100 while breakout ports scale linearly from 8 to 40. Every
case has reciprocal random via pairings and two-terminal nets whose breakout
ports are randomly assigned around the top, right, and bottom boundaries.

Regenerate the dataset or run the benchmark with:

```sh
bun run generate:stress-dataset
bun run benchmark:stress
```

The benchmark warms up once, measures each case once, and writes machine-readable
and Markdown reports under `benchmarks/results`. Successful-solve percentiles
only include solved cases; attempt percentiles include both solved and failed
cases. The current Bun 1.3.2 macOS arm64 run produced:

| Via ports | Breakout ports | Solved | Solved p50 (ms) | Solved p95 (ms) | Attempt p50 (ms) | Attempt p95 (ms) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | 8 | 3/4 (75%) | 0.88 | 1.82 | 1.40 | 5.12 |
| 40 | 16 | 2/4 (50%) | 6.41 | 8.52 | 11.49 | 22.35 |
| 60 | 24 | 0/4 (0%) | n/a | n/a | 102.65 | 188.31 |
| 80 | 32 | 0/4 (0%) | n/a | n/a | 217.69 | 944.56 |
| 100 | 40 | 0/4 (0%) | n/a | n/a | 360.17 | 821.48 |
| **Overall** | **8–40** | **5/20 (25%)** | **1.92** | **7.81** | **102.65** | **910.16** |

### Production-shaped corpus

`production-boundary-problems-v2` adds 20 deterministic, known-feasible random
configurations of a fixed production-sized profile:

- 80 reciprocally paired via ports;
- 120 breakout ports across exactly 80 nets;
- 12 VCC ports and 12 GND ports;
- 18 two-port signal nets and 60 singleton signal nets.

The two power nets each produce an 11-edge connection tree, while the 18
two-port signal nets produce one route each. Singleton nets need no routing, so
each sample has 40 route demands. Every case includes an intersection-free
route certificate used by dataset validation; the benchmark solver receives
only the routing problem and must independently find a solution.

The production profile routes smaller two-terminal nets before the merge-friendly
power trees and uses scale-appropriate negotiated-routing limits:
`ripCost: 60`, `maxRipsPerRoute: 24`, and `maxTotalRips: 300`.

Regenerate and benchmark this corpus with:

```sh
bun run generate:production-stress-dataset
bun run benchmark:production-stress
```

The production command enforces a 100% minimum solve rate and exits nonzero on a
regression. On the same Bun 1.3.2 macOS arm64 environment, the current result is:

| Via ports | Breakout ports | Nets | Samples solved | Successful p50/p95 | Attempt p50/p95 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 80 | 120 | 80 | 20/20 (100%) | 150.24/906.75 ms | 150.24/906.75 ms |

The production Cosmos fixture makes all 20 samples browsable with sample tabs,
previous/next controls, URL query state, checked-in benchmark metrics, and a
fresh `GenericSolverDebugger` for the selected problem. The debugger shows
pipeline stages, committed vector traces, via jumps, the active A* frontier,
and which spanning-tree attempt is active.

The checked-in `vercel.json` follows the other tscircuit solver preview sites:
Vercel installs with Bun, runs `bun run build:site`, and serves the generated
`cosmos-export` directory. The repository is connected to Vercel's Git
integration, so pushes and pull requests automatically receive deployments.

`fixtures/eight-breakout-twenty-via.fixture.tsx` provides a larger visual
example with eight breakout ports on the top, right, and bottom and twenty via
ports on the same three sides of the outer boundary. Each via pair gets a
unique color and is drawn as a slightly irregular, line-segmented parabolic
curve outside the via boundary. Its test converts
`solver.visualize()` with `getSvgFromGraphicsObject` and checks the result with
`bun-match-svg`'s `toMatchSvgSnapshot`.

## Prototype limits

- Visibility nodes are breakout and via ports; the prototype does not yet
  introduce optimized free-space bend points or physical trace clearance.
- Via jumps are topological escape edges. Their outside-boundary curves explain
  pairing but do not represent copper and are excluded from intersection tests.
- Net decomposition retries deterministic nearest-tree and root-star shapes; it
  is not a Steiner optimizer.
- Rip-up is negotiated and bounded, not a completeness proof; hard instances
  can still exhaust the configured search or rip limits.
