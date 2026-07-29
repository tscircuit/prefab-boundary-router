import { expect, test } from "bun:test"
import productionDatasetJson from "../benchmarks/datasets/production-boundary-problems.json"
import type { ProductionStressProblemDataset } from "../benchmarks/production-stress-dataset"
import { BoundaryRoutingPipelineSolver } from "../lib"
import { assertValidSolution } from "./fixtures/assert-valid-solution"

const dataset = productionDatasetJson as ProductionStressProblemDataset

test("routes the former strategy-retry case through the assignment pipeline", () => {
  const problemCase = dataset.cases.find(
    (candidate) => candidate.caseId === "production-c02",
  )!
  const solver = new BoundaryRoutingPipelineSolver(problemCase.problem)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.hasStageOutput("assign")).toBe(true)
  expect(solver.hasStageOutput("route")).toBe(true)
  const solution = solver.getOutput()!
  expect(solution.routes).toHaveLength(40)
  assertValidSolution(problemCase.problem, solution)
})
