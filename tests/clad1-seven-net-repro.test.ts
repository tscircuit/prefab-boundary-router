import { expect, test } from "bun:test"
import { BoundaryRoutingPipelineSolver } from "../lib"
import { assertValidSolution } from "./fixtures/assert-valid-solution"
import { clad1SevenNetReproProblem } from "./fixtures/clad1-seven-net-repro-problem"

test("routes the seven-net Clad1 fanout handoff through its paired vias", () => {
  const solver = new BoundaryRoutingPipelineSolver(clad1SevenNetReproProblem)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.routingSolver?.stats.attempt).toBe(3)
  expect(solver.routingSolver?.stats.attemptStrategy).toBe(
    "nearest-tree-seeded-order-3",
  )
  const solution = solver.getOutput()!
  expect(solution.routes).toHaveLength(10)
  assertValidSolution(clad1SevenNetReproProblem, solution)
}, 60_000)
