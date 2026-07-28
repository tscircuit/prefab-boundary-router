# Prefab Boundary Router

`@tscircuit/prefab-boundary-router` is a standalone TypeScript solver built
around `@tscircuit/solver-utils`.

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

`BoundaryRoutingPipelineSolver` is a two-stage `BasePipelineSolver`:

1. `PrepareBoundaryRoutingProblemSolver` validates the geometry, creates a
   continuous visibility graph whose nodes are breakout and via ports, adds
   paired-via jump edges, and reduces each multi-terminal net to a deterministic
   tree of two-terminal demands.
2. `RipUpAStarBoundarySolver` routes those demands incrementally with A*.

There is no raster or routing grid. Trace edges are direct Euclidean vectors
between mutually visible graph nodes, so solutions naturally contain arbitrary
angles. The A* heuristic is an exact uncongested distance map over that graph
and remains admissible when a via jump is cheaper than its geometric distance.

## Rip-up behavior

An A* state carries the sorted set of committed foreign routes its candidate
path would intersect or whose via resources it would occupy. Adding a new
blocker pays `ripCost`; each intersecting candidate edge pays `crossingCost`.
When the candidate reaches its goal, only those blocker routes are removed and
requeued.

Every edge removed by rip-up receives `historyIncrement`. This negotiated
congestion cost makes repeatedly contested vector paths more expensive on
subsequent attempts. The per-search blocker count, per-route rip count, total
rip count, and A* state count are all bounded.

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
  options: { viaJumpCost: 0.25 },
}

const solver = new BoundaryRoutingPipelineSolver(problem)
solver.solve()

if (solver.failed) throw new Error(solver.error ?? "routing failed")
console.log(solver.getOutput())
```

Run the project with:

```sh
bun install
bun run test
bun run build
```

The Cosmos fixture uses `GenericSolverDebugger`, showing pipeline stages,
committed vector traces, via jumps, and the active A* frontier.

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
- Net decomposition is a deterministic nearest-tree, not a Steiner optimizer.
- Rip-up is negotiated and bounded, not a completeness proof; hard instances
  can still exhaust the configured search or rip limits.
