import { expect, test } from "bun:test"
import {
  BoundaryRoutingPipelineSolver,
  type BoundaryRoutingProblem,
  prepareBoundaryRoutingProblem,
} from "../lib"
import { assertValidSolution } from "./fixtures/assert-valid-solution"
import postFanoutProblemJson from "./fixtures/clad1-rp2040-current-all-nets-post-fanout.json"

// Captured from the current tscircuit/clad1 RP2040 example immediately after
// fanout, with every connection included in prefab-boundary routing. The
// capture includes the short pad-pair preprocessing and capacitor placements
// merged after the earlier no-testpoint reproduction.
const postFanoutProblem =
  postFanoutProblemJson as unknown as BoundaryRoutingProblem

test("captures the current all-net Clad1 RP2040 fanout problem", () => {
  expect(postFanoutProblem.breakoutBoundary.ports).toHaveLength(95)
  expect(postFanoutProblem.viaBoundary.ports).toHaveLength(80)
  expect(
    postFanoutProblem.breakoutBoundary.ports.filter(
      (port) => port.x === postFanoutProblem.breakoutBoundary.minX,
    ),
  ).toHaveLength(2)
  expect(
    new Set(
      postFanoutProblem.breakoutBoundary.ports.map(
        (port) => `${port.x},${port.y}`,
      ),
    ).size,
  ).toBe(95)
  expect(
    new Set(postFanoutProblem.breakoutBoundary.ports.map((port) => port.netId))
      .size,
  ).toBe(25)

  const preparedProblem = prepareBoundaryRoutingProblem(postFanoutProblem)
  expect(preparedProblem.demands).toHaveLength(70)
})

test("routes every current Clad1 RP2040 net after fanout", () => {
  const solver = new BoundaryRoutingPipelineSolver(postFanoutProblem)
  solver.solve()

  if (!solver.solved) {
    const stats = solver.getOutput()?.stats
    throw new Error(
      [
        solver.error ?? "Prefab boundary routing failed",
        stats
          ? `${stats.routedCount}/${stats.routeCount} demands committed after ${stats.ripCount} rip-ups`
          : null,
      ]
        .filter(Boolean)
        .join("; "),
    )
  }

  expect(solver.failed).toBe(false)
  expect(solver.routingSolver?.stats.attemptStrategy).toBe("global-hypergraph")
  const solution = solver.getOutput()!
  expect(solution.routes).toHaveLength(70)
  assertValidSolution(postFanoutProblem, solution)
}, 60_000)
