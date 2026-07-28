import { describe, expect, test } from "bun:test"
import datasetJson from "../benchmarks/datasets/random-boundary-problems.json"
import {
  generateStressDataset,
  STRESS_CASES_PER_VIA_COUNT,
  STRESS_VIA_COUNTS,
  type StressProblemDataset,
} from "../benchmarks/stress-dataset"
import { prepareBoundaryRoutingProblem } from "../lib"
import { isPointOnRectBoundary } from "../lib/geometry"

const dataset = datasetJson as StressProblemDataset

describe("random stress dataset", () => {
  test("matches the deterministic generator", () => {
    expect(dataset).toEqual(generateStressDataset())
  })

  test("covers each via-count bucket with valid reciprocal pairs", () => {
    expect(dataset.cases).toHaveLength(
      STRESS_VIA_COUNTS.length * STRESS_CASES_PER_VIA_COUNT,
    )

    for (const viaCount of STRESS_VIA_COUNTS) {
      expect(
        dataset.cases.filter(
          (problemCase) => problemCase.viaCount === viaCount,
        ),
      ).toHaveLength(STRESS_CASES_PER_VIA_COUNT)
    }

    for (const problemCase of dataset.cases) {
      const { problem } = problemCase
      expect(problemCase.viaCount).toBeLessThanOrEqual(100)
      expect(problemCase.breakoutPortCount).toBe(problemCase.viaCount * 0.4)
      expect(problem.viaBoundary.ports).toHaveLength(problemCase.viaCount)
      expect(problem.breakoutBoundary.ports).toHaveLength(
        problemCase.breakoutPortCount,
      )
      expect(problemCase.netCount * 2).toBe(problemCase.breakoutPortCount)

      const viaByPortId = new Map(
        problem.viaBoundary.ports.map((port) => [port.portId, port]),
      )
      for (const port of problem.viaBoundary.ports) {
        expect(port.portId).toStartWith(problemCase.caseId)
        expect(viaByPortId.get(port.pairedPortId)?.pairedPortId).toBe(
          port.portId,
        )
        expect(isPointOnRectBoundary(port, problem.viaBoundary)).toBe(true)
        expect(
          port.y === problem.viaBoundary.minY ||
            port.x === problem.viaBoundary.maxX ||
            port.y === problem.viaBoundary.maxY,
        ).toBe(true)
      }

      const portsPerNet = new Map<string, number>()
      for (const port of problem.breakoutBoundary.ports) {
        portsPerNet.set(port.netId, (portsPerNet.get(port.netId) ?? 0) + 1)
        expect(isPointOnRectBoundary(port, problem.breakoutBoundary)).toBe(true)
        expect(
          port.y === problem.breakoutBoundary.minY ||
            port.x === problem.breakoutBoundary.maxX ||
            port.y === problem.breakoutBoundary.maxY,
        ).toBe(true)
      }
      expect([...portsPerNet.values()].every((count) => count === 2)).toBe(true)
      expect(() => prepareBoundaryRoutingProblem(problem)).not.toThrow()
    }
  })
})
