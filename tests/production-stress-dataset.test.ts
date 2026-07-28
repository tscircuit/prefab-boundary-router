import { describe, expect, test } from "bun:test"
import datasetJson from "../benchmarks/datasets/production-boundary-problems.json"
import {
  generateProductionStressDataset,
  POWER_NET_PORT_COUNT,
  PRODUCTION_BREAKOUT_PORT_COUNT,
  PRODUCTION_NET_COUNT,
  PRODUCTION_ROUTE_DEMAND_COUNT,
  PRODUCTION_SAMPLE_COUNT,
  PRODUCTION_VIA_COUNT,
  type ProductionStressProblemDataset,
  SIGNAL_NET_COUNT,
  SINGLE_PORT_SIGNAL_NET_COUNT,
  TWO_PORT_SIGNAL_NET_COUNT,
} from "../benchmarks/production-stress-dataset"
import { prepareBoundaryRoutingProblem } from "../lib"
import { isPointOnRectBoundary } from "../lib/geometry"

const dataset = datasetJson as ProductionStressProblemDataset

describe("production-shaped stress dataset", () => {
  test("matches the deterministic generator", () => {
    expect(dataset).toEqual(generateProductionStressDataset())
  })

  test("models the production port and net distribution", () => {
    expect(dataset.cases).toHaveLength(PRODUCTION_SAMPLE_COUNT)
    expect(
      new Set(dataset.cases.map((problemCase) => problemCase.seed)).size,
    ).toBe(PRODUCTION_SAMPLE_COUNT)
    expect(dataset.profile).toEqual({
      viaCount: PRODUCTION_VIA_COUNT,
      breakoutPortCount: PRODUCTION_BREAKOUT_PORT_COUNT,
      netCount: PRODUCTION_NET_COUNT,
      powerNetPortCounts: {
        VCC: POWER_NET_PORT_COUNT,
        GND: POWER_NET_PORT_COUNT,
      },
      twoPortSignalNetCount: TWO_PORT_SIGNAL_NET_COUNT,
      singlePortSignalNetCount: SINGLE_PORT_SIGNAL_NET_COUNT,
    })

    for (const problemCase of dataset.cases) {
      const { problem } = problemCase
      expect(problemCase.viaCount).toBe(PRODUCTION_VIA_COUNT)
      expect(problemCase.breakoutPortCount).toBe(PRODUCTION_BREAKOUT_PORT_COUNT)
      expect(problemCase.netCount).toBe(PRODUCTION_NET_COUNT)
      expect(problem.viaBoundary.ports).toHaveLength(PRODUCTION_VIA_COUNT)
      expect(problem.breakoutBoundary.ports).toHaveLength(
        PRODUCTION_BREAKOUT_PORT_COUNT,
      )

      const viaByPortId = new Map(
        problem.viaBoundary.ports.map((port) => [port.portId, port]),
      )
      for (const port of problem.viaBoundary.ports) {
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

      expect(portsPerNet.size).toBe(PRODUCTION_NET_COUNT)
      expect(portsPerNet.get("VCC")).toBe(POWER_NET_PORT_COUNT)
      expect(portsPerNet.get("GND")).toBe(POWER_NET_PORT_COUNT)
      const signalNetPortCounts = [...portsPerNet]
        .filter(([netId]) => netId !== "VCC" && netId !== "GND")
        .map(([, portCount]) => portCount)
      expect(signalNetPortCounts).toHaveLength(SIGNAL_NET_COUNT)
      expect(
        signalNetPortCounts.filter((portCount) => portCount === 2),
      ).toHaveLength(TWO_PORT_SIGNAL_NET_COUNT)
      expect(
        signalNetPortCounts.every(
          (portCount) => portCount === 1 || portCount === 2,
        ),
      ).toBe(true)
      expect(prepareBoundaryRoutingProblem(problem).demands).toHaveLength(
        PRODUCTION_ROUTE_DEMAND_COUNT,
      )
    }
  })
})
