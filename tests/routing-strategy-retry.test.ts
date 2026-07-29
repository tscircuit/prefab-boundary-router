import { expect, test } from "bun:test"
import productionDatasetJson from "../benchmarks/datasets/production-boundary-problems.json"
import type { ProductionStressProblemDataset } from "../benchmarks/production-stress-dataset"
import { BoundaryRoutingPipelineSolver } from "../lib"
import { assertValidSolution } from "./fixtures/assert-valid-solution"

const dataset = productionDatasetJson as ProductionStressProblemDataset

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
