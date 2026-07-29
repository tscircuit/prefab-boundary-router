import { expect, test } from "bun:test"
import {
  BoundaryRoutingPipelineSolver,
  type BoundaryRoutingProblem,
  prepareBoundaryRoutingProblem,
} from "../lib"
import { assertValidSolution } from "./fixtures/assert-valid-solution"
import postFanoutProblemJson from "./fixtures/clad1-rp2040-post-fanout.json"

// Captured from tscircuit/clad1#14 after removing the RP2040 testpoints,
// immediately after FanoutSolver finishes and before prefab boundary routing.
const postFanoutProblem =
  postFanoutProblemJson as unknown as BoundaryRoutingProblem

test("captures the no-testpoint Clad1 RP2040 fanout problem", () => {
  expect(postFanoutProblem.breakoutBoundary.ports).toHaveLength(114)
  expect(postFanoutProblem.viaBoundary.ports).toHaveLength(80)
  expect(
    new Set(
      postFanoutProblem.breakoutBoundary.ports.map(
        (port) => `${port.x},${port.y}`,
      ),
    ).size,
  ).toBe(114)
  expect(
    new Set(postFanoutProblem.breakoutBoundary.ports.map((port) => port.netId))
      .size,
  ).toBe(25)

  const preparedProblem = prepareBoundaryRoutingProblem(postFanoutProblem)
  expect(preparedProblem.demands).toHaveLength(89)
})

test.failing("routes the no-testpoint Clad1 RP2040 board after fanout", () => {
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
  expect(solution.routes).toHaveLength(89)
  assertValidSolution(postFanoutProblem, solution)
})
