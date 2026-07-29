import { expect, test } from "bun:test"
import { BoundaryRoutingPipelineSolver } from "../lib"
import { clad1SevenNetProblem } from "./fixtures/clad1-seven-net-problem"

test("routes the seven-net Clad1 fanout handoff through its paired vias", () => {
  const solver = new BoundaryRoutingPipelineSolver(clad1SevenNetProblem)
  solver.solve()

  // Current behavior: the final net cannot be routed despite 40 available via
  // pairs. This expectation describes the intended solver behavior.
  expect(solver.solved).toBe(true)
}, 60_000)
