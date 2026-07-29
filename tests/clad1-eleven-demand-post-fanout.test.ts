import { expect, test } from "bun:test"
import {
  BoundaryRoutingPipelineSolver,
  type BoundaryRoutingProblem,
  prepareBoundaryRoutingProblem,
} from "../lib"
import postFanoutProblemJson from "./fixtures/clad1-eleven-demand-post-fanout.json"

const postFanoutProblem =
  postFanoutProblemJson as unknown as BoundaryRoutingProblem

test("captures the Clad1 failure after adding source_trace_104", () => {
  expect(postFanoutProblem.breakoutBoundary.ports).toHaveLength(21)
  expect(postFanoutProblem.viaBoundary.ports).toHaveLength(80)
  expect(
    new Set(postFanoutProblem.breakoutBoundary.ports.map((port) => port.netId))
      .size,
  ).toBe(10)
  expect(prepareBoundaryRoutingProblem(postFanoutProblem).demands).toHaveLength(
    11,
  )
})

test.failing("routes Clad1 after adding source_trace_104", () => {
  const solver = new BoundaryRoutingPipelineSolver(postFanoutProblem)
  solver.solve()

  expect(solver.solved).toBe(true)
}, 180_000)
