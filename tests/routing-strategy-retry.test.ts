import { expect, test } from "bun:test"
import productionDatasetJson from "../benchmarks/datasets/production-boundary-problems.json"
import doubleBreakoutDatasetJson from "../benchmarks/datasets/production-double-breakout-boundary-problems.json"
import type { ProductionStressProblemDataset } from "../benchmarks/production-stress-dataset"
import { BoundaryRoutingPipelineSolver } from "../lib"
import { assertValidSolution } from "./fixtures/assert-valid-solution"

const dataset = productionDatasetJson as ProductionStressProblemDataset
const doubleBreakoutDataset =
  doubleBreakoutDatasetJson as ProductionStressProblemDataset

test("retries a failed nearest-tree route with a root-star decomposition", () => {
  const problemCase = dataset.cases.find(
    (candidate) => candidate.caseId === "production-c02",
  )!
  const solver = new BoundaryRoutingPipelineSolver(problemCase.problem)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.routingSolver?.stats.attempt).toBe(2)
  expect(solver.routingSolver?.stats.attemptStrategy).toBe("root-star")
  const solution = solver.getOutput()!
  expect(solution.routes).toHaveLength(40)
  assertValidSolution(problemCase.problem, solution)
})

test("retries difficult identifier ordering with a higher via-jump penalty", () => {
  const problemCase = doubleBreakoutDataset.cases.find(
    (candidate) => candidate.caseId === "production-double-breakout-c19",
  )!
  const solver = new BoundaryRoutingPipelineSolver(problemCase.problem)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.routingSolver?.stats.attempt).toBe(4)
  expect(solver.routingSolver?.stats.attemptStrategy).toBe(
    "nearest-tree-shortest-first-via-penalty",
  )
  const solution = solver.getOutput()!
  expect(solution.routes).toHaveLength(problemCase.knownRoutePlan.length)
  assertValidSolution(problemCase.problem, solution)
})
