import { expect, test } from "bun:test"
import {
  BoundaryRoutingPipelineSolver,
  type BoundaryRoutingProblem,
} from "../lib"
import { clad1SevenNetProblem } from "./fixtures/clad1-seven-net-problem"

const toClad1HoleId = (fixturePortId: string) => {
  const [side, row, index] = fixturePortId.split(":")
  return `hole_${side}_${row}_${index!.padStart(3, "0")}`
}

// Captured while adding Clad1 RP2040 nets to prefab-boundary-router one at a
// time. Every three-net subset routes, but this four-net combination fails.
export const fourNetProblem: BoundaryRoutingProblem = {
  breakoutBoundary: {
    minX: -50,
    maxX: 28,
    minY: -15,
    maxY: 15,
    ports: [
      {
        portId: "fanout:source_trace_60::fanout:0",
        netId: "connectivity_net270",
        x: 4.800000000000004,
        y: 15,
      },
      {
        portId: "fanout:source_trace_60::fanout:1",
        netId: "connectivity_net270",
        x: 3.6000000000000014,
        y: 15,
      },
      {
        portId: "fanout:source_trace_73::fanout:0",
        netId: "connectivity_net266",
        x: -3.3999999999999986,
        y: -15,
      },
      {
        portId: "fanout:source_trace_73::fanout:1",
        netId: "connectivity_net266",
        x: -8.399999999999999,
        y: 15,
      },
      {
        portId: "fanout:source_trace_116::fanout:0",
        netId: "connectivity_net289",
        x: 4,
        y: 15,
      },
      {
        portId: "fanout:source_trace_116::fanout:1",
        netId: "connectivity_net289",
        x: 28,
        y: -4.799999999999999,
      },
      {
        portId: "fanout:source_trace_117::fanout:0",
        netId: "connectivity_net292",
        x: 3.8000000000000043,
        y: 15,
      },
      {
        portId: "fanout:source_trace_117::fanout:1",
        netId: "connectivity_net292",
        x: 28,
        y: 0.20000000000000107,
      },
    ].map((port) => ({
      ...port,
      route_type: "wire",
      width: 0.1,
      layer: "top",
    })),
  },
  viaBoundary: {
    ...clad1SevenNetProblem.viaBoundary,
    ports: clad1SevenNetProblem.viaBoundary.ports.map((port) => ({
      ...port,
      portId: toClad1HoleId(port.portId),
      pairedPortId: toClad1HoleId(port.pairedPortId),
      y: port.portId.startsWith("right:r1:") ? port.y + 5 : port.y,
    })),
  },
  options: {
    ripCost: 8,
    maxBlockersPerSearch: 24,
    maxRipsPerRoute: 24,
    maxTotalRips: 3_000,
    maxSearchStates: 1_000_000,
  },
}

test("routes the four-net Clad1 incremental handoff", () => {
  const solver = new BoundaryRoutingPipelineSolver(fourNetProblem)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.routingSolver?.stats.attempt).toBe(1)
}, 60_000)
