import { expect, test } from "bun:test"
import { BoundaryRoutingPipelineSolver } from "../lib"
import { clad1SevenNetProblem } from "./fixtures/clad1-seven-net-problem"

test("routes the seven-net Clad1 fanout handoff through its paired vias", () => {
  const solver = new BoundaryRoutingPipelineSolver(clad1SevenNetProblem)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.routingSolver?.stats).toMatchObject({
    attempt: 3,
    attemptStrategy: "nearest-tree-shortest-first",
    routedCount: 10,
  })
}, 60_000)
