import { describe, expect, test } from "bun:test"
import type { BoundaryRoutingProblem } from "../lib"
import { BoundaryRoutingPipelineSolver } from "../lib"
import { assertValidSolution } from "./fixtures/assert-valid-solution"

describe("multi-terminal nets", () => {
  test("routes a deterministic net tree without cross-net intersections", () => {
    const problem: BoundaryRoutingProblem = {
      viaBoundary: {
        minX: 0,
        minY: 0,
        maxX: 12,
        maxY: 12,
        ports: [],
      },
      breakoutBoundary: {
        minX: 3,
        minY: 3,
        maxX: 9,
        maxY: 9,
        ports: [
          { portId: "a1", netId: "A", x: 3, y: 3 },
          { portId: "a2", netId: "A", x: 5, y: 3 },
          { portId: "a3", netId: "A", x: 7, y: 3 },
          { portId: "b1", netId: "B", x: 5, y: 9 },
          { portId: "b2", netId: "B", x: 7, y: 9 },
        ],
      },
      options: { expansionsPerStep: 20 },
    }

    const solver = new BoundaryRoutingPipelineSolver(problem)
    solver.solve()

    expect(solver.solved).toBe(true)
    const solution = solver.getOutput()!
    expect(solution.routes).toHaveLength(3)
    expect(solution.stats.routeCount).toBe(3)
    assertValidSolution(problem, solution)
  })
})
