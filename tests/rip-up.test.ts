import { describe, expect, test } from "bun:test"
import { BoundaryRoutingPipelineSolver } from "../lib"
import { assertValidSolution } from "./fixtures/assert-valid-solution"
import { demoProblem } from "./fixtures/demo-problem"

describe("boundary routing pipeline", () => {
  test("separates via assignment from physical routing", () => {
    const solver = new BoundaryRoutingPipelineSolver(demoProblem)
    solver.solve()

    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    const solution = solver.getOutput()!
    expect(solver.hasStageOutput("assign")).toBe(true)
    expect(solver.hasStageOutput("route")).toBe(true)
    expect(solution.stats.routedCount).toBe(solution.stats.routeCount)
    expect(solution.routes).toHaveLength(2)
    expect(solution.stats.viaJumpCount).toBe(2)
    assertValidSolution(demoProblem, solution)
  })
})
