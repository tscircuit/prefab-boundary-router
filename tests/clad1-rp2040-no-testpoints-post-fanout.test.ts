import { expect, test } from "bun:test"
import {
  BoundaryRoutingPipelineSolver,
  type BoundaryRoutingProblem,
  prepareBoundaryRoutingProblem,
} from "../lib"
import { assertValidSolution } from "./fixtures/assert-valid-solution"
import postFanoutProblemJson from "./fixtures/clad1-rp2040-no-testpoints-post-fanout.json"

// Captured from tscircuit/clad1#16 immediately after FanoutSolver finishes and
// before prefab boundary routing. Left-edge exits are excluded because Clad1
// has no prefab via-boundary ports on that side.
const postFanoutProblem =
  postFanoutProblemJson as unknown as BoundaryRoutingProblem

test("captures the no-testpoint Clad1 RP2040 fanout problem", () => {
  expect(postFanoutProblem.breakoutBoundary.ports).toHaveLength(106)
  expect(postFanoutProblem.viaBoundary.ports).toHaveLength(80)
  expect(
    postFanoutProblem.breakoutBoundary.ports.every(
      (port) => port.x !== postFanoutProblem.breakoutBoundary.minX,
    ),
  ).toBe(true)
  expect(
    new Set(
      postFanoutProblem.breakoutBoundary.ports.map(
        (port) => `${port.x},${port.y}`,
      ),
    ).size,
  ).toBe(106)
  expect(
    new Set(postFanoutProblem.breakoutBoundary.ports.map((port) => port.netId))
      .size,
  ).toBe(25)

  const preparedProblem = prepareBoundaryRoutingProblem(postFanoutProblem)
  expect(preparedProblem.demands).toHaveLength(81)
})

test("routes the no-testpoint Clad1 RP2040 board after fanout", () => {
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
  expect(solution.routes).toHaveLength(81)
  assertValidSolution(postFanoutProblem, solution)
})
