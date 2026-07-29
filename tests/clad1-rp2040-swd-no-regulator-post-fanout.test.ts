import { expect, test } from "bun:test"
import {
  BoundaryRoutingPipelineSolver,
  type BoundaryRoutingProblem,
  prepareBoundaryRoutingProblem,
} from "../lib"
import { assertValidSolution } from "./fixtures/assert-valid-solution"
import postFanoutProblemJson from "./fixtures/clad1-rp2040-swd-no-regulator-post-fanout.json"

// Captured from tscircuit/clad1#23 at commit 845a7d8 immediately after
// fanout. USB, the crystal, their support parts, and the 3V3 regulator path
// are removed; SWD is exposed through a four-pin header.
const postFanoutProblem =
  postFanoutProblemJson as unknown as BoundaryRoutingProblem

test("captures the SWD-only Clad1 RP2040 fanout problem", () => {
  expect(postFanoutProblem.breakoutBoundary.ports).toHaveLength(67)
  expect(postFanoutProblem.viaBoundary.ports).toHaveLength(80)
  expect(
    postFanoutProblem.breakoutBoundary.ports.filter(
      (port) => port.x === postFanoutProblem.breakoutBoundary.minX,
    ),
  ).toHaveLength(0)
  expect(
    new Set(
      postFanoutProblem.breakoutBoundary.ports.map(
        (port) => `${port.x},${port.y}`,
      ),
    ).size,
  ).toBe(67)
  expect(
    new Set(postFanoutProblem.breakoutBoundary.ports.map((port) => port.netId))
      .size,
  ).toBe(16)

  const preparedProblem = prepareBoundaryRoutingProblem(postFanoutProblem)
  expect(preparedProblem.demands).toHaveLength(51)
})

test.failing("routes every SWD-only Clad1 RP2040 net after fanout", () => {
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
  expect(solution.routes).toHaveLength(51)
  assertValidSolution(postFanoutProblem, solution)
}, 60_000)
