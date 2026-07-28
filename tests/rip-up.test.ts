import { describe, expect, test } from "bun:test"
import { BoundaryRoutingPipelineSolver } from "../lib"
import { assertValidSolution } from "./fixtures/assert-valid-solution"
import { demoProblem } from "./fixtures/demo-problem"

describe("negotiated rip-up", () => {
  test("rips a cheaper first route, adds history, and converges", () => {
    const solver = new BoundaryRoutingPipelineSolver(demoProblem)
    solver.solve()

    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    const solution = solver.getOutput()!
    expect(solution.stats.ripCount).toBeGreaterThan(0)
    expect(solution.stats.maxHistoryCost).toBeGreaterThan(0)
    expect(solution.routes).toHaveLength(2)
    expect(solution.stats.viaJumpCount).toBe(2)
    assertValidSolution(demoProblem, solution)
  })
})
