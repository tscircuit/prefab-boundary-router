import { describe, expect, test } from "bun:test"
import type { BoundaryRoutingProblem } from "../lib"
import { BoundaryRoutingPipelineSolver } from "../lib"
import { assertValidSolution } from "./fixtures/assert-valid-solution"

describe("via-boundary teleportation", () => {
  test("uses a paired via edge when it beats walking around the breakout", () => {
    const problem: BoundaryRoutingProblem = {
      viaBoundary: {
        minX: 0,
        minY: 0,
        maxX: 10,
        maxY: 10,
        ports: [
          { id: "left-via", pairedPortId: "right-via", x: 0, y: 5 },
          { id: "right-via", pairedPortId: "left-via", x: 10, y: 5 },
        ],
      },
      breakoutBoundary: {
        minX: 2,
        minY: 2,
        maxX: 8,
        maxY: 8,
        ports: [
          { id: "left", netId: "signal", x: 2, y: 5 },
          { id: "right", netId: "signal", x: 8, y: 5 },
        ],
      },
      options: { expansionsPerStep: 10 },
    }

    const solver = new BoundaryRoutingPipelineSolver(problem)
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.hasStageOutput("prepare")).toBe(true)
    expect(solver.hasStageOutput("route")).toBe(true)
    const solution = solver.getOutput()!
    expect(solution.routes).toHaveLength(1)
    expect(
      solution.routes[0]!.segments.some(
        (segment) => segment.kind === "via_jump",
      ),
    ).toBe(true)
    expect(solution.stats.viaJumpCount).toBe(1)
    assertValidSolution(problem, solution)
  })
})
