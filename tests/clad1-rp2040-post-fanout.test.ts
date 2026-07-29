import { expect, test } from "bun:test"
import {
  BoundaryRoutingPipelineSolver,
  type BoundaryRoutingProblem,
  prepareBoundaryRoutingProblem,
} from "../lib"
import { assertValidSolution } from "./fixtures/assert-valid-solution"
import postFanoutProblemJson from "./fixtures/clad1-rp2040-post-fanout.json"

// Captured from tscircuit/clad1#14 immediately after FanoutSolver finishes and
// before the prefab-boundary-router stage begins.
const postFanoutProblem =
  postFanoutProblemJson as unknown as BoundaryRoutingProblem

test("routes the Clad1 RP2040 board after fanout", () => {
  expect(postFanoutProblem.breakoutBoundary.ports).toHaveLength(120)
  expect(postFanoutProblem.viaBoundary.ports).toHaveLength(80)
  expect(
    new Set(postFanoutProblem.breakoutBoundary.ports.map((port) => port.netId))
      .size,
  ).toBe(27)

  const preparedProblem = prepareBoundaryRoutingProblem(postFanoutProblem)
  expect(preparedProblem.demands).toHaveLength(93)

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
  const solution = solver.getOutput()!
  expect(solver.routingSolver?.stats.attemptStrategy).toBe("global-hypergraph")
  expect(solution.routes).toHaveLength(93)
  assertValidSolution(postFanoutProblem, solution)
})
