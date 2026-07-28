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
import type { BoundaryRoutingSolution, RoutedConnection } from "../lib"
import { prepareBoundaryRoutingProblem } from "../lib"
import { isPointOnRectBoundary } from "../lib/geometry"
import { assertValidSolution } from "./fixtures/assert-valid-solution"

const dataset = datasetJson as ProductionStressProblemDataset

describe("production-shaped stress dataset", () => {
  test("matches the deterministic generator", () => {
    expect(dataset).toEqual(generateProductionStressDataset())
  })

  test("models the production port and net distribution", () => {
    expect(dataset.cases).toHaveLength(PRODUCTION_SAMPLE_COUNT)
    expect(dataset.minimumSolvePercent).toBe(50)
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
      const preparedProblem = prepareBoundaryRoutingProblem(problem)
      expect(preparedProblem.demands).toHaveLength(
        PRODUCTION_ROUTE_DEMAND_COUNT,
      )
      expect(problemCase.knownRoutePlan).toHaveLength(
        PRODUCTION_ROUTE_DEMAND_COUNT,
      )
      expect(
        new Set(
          problemCase.knownRoutePlan.flatMap((connection) => [
            connection.entryViaPortId,
            connection.exitViaPortId,
          ]),
        ).size,
      ).toBe(PRODUCTION_VIA_COUNT)

      const breakoutPortById = new Map(
        problem.breakoutBoundary.ports.map((port) => [port.portId, port]),
      )
      const knownRoutes: RoutedConnection[] = problemCase.knownRoutePlan.map(
        (connection, connectionIndex) => {
          const sourcePort = breakoutPortById.get(connection.sourcePortId)!
          const targetPort = breakoutPortById.get(connection.targetPortId)!
          const entryViaPort = viaByPortId.get(connection.entryViaPortId)!
          const exitViaPort = viaByPortId.get(connection.exitViaPortId)!
          const sourceNode = preparedProblem.breakoutPortNodeById.get(
            sourcePort.portId,
          )!
          const targetNode = preparedProblem.breakoutPortNodeById.get(
            targetPort.portId,
          )!
          const entryViaNode = preparedProblem.viaPortNodeById.get(
            entryViaPort.portId,
          )!
          const exitViaNode = preparedProblem.viaPortNodeById.get(
            exitViaPort.portId,
          )!
          expect(
            preparedProblem.adjacency[sourceNode]!.some(
              (edge) => edge.kind === "trace" && edge.toNode === entryViaNode,
            ),
          ).toBe(true)
          expect(
            preparedProblem.adjacency[entryViaNode]!.some(
              (edge) => edge.kind === "via_jump" && edge.toNode === exitViaNode,
            ),
          ).toBe(true)
          expect(
            preparedProblem.adjacency[exitViaNode]!.some(
              (edge) => edge.kind === "trace" && edge.toNode === targetNode,
            ),
          ).toBe(true)

          const source = {
            nodeId: `breakout:${sourcePort.portId}`,
            kind: "breakout_port" as const,
            x: sourcePort.x,
            y: sourcePort.y,
          }
          const entry = {
            nodeId: `via:${entryViaPort.portId}`,
            kind: "via_port" as const,
            x: entryViaPort.x,
            y: entryViaPort.y,
          }
          const exit = {
            nodeId: `via:${exitViaPort.portId}`,
            kind: "via_port" as const,
            x: exitViaPort.x,
            y: exitViaPort.y,
          }
          const target = {
            nodeId: `breakout:${targetPort.portId}`,
            kind: "breakout_port" as const,
            x: targetPort.x,
            y: targetPort.y,
          }
          return {
            routeId: `known-route-${connectionIndex}`,
            netId: connection.netId,
            sourcePortId: sourcePort.portId,
            targetPortId: targetPort.portId,
            points: [source, entry, exit, target],
            segments: [
              {
                kind: "trace" as const,
                edgeKey: `known-trace-${connectionIndex}-source`,
                from: source,
                to: entry,
              },
              {
                kind: "via_jump" as const,
                edgeKey: `known-via-${connectionIndex}`,
                from: entry,
                to: exit,
                entryPortId: entryViaPort.portId,
                exitPortId: exitViaPort.portId,
              },
              {
                kind: "trace" as const,
                edgeKey: `known-trace-${connectionIndex}-target`,
                from: exit,
                to: target,
              },
            ],
            usedViaPortIds: [entryViaPort.portId, exitViaPort.portId],
          }
        },
      )
      const knownSolution: BoundaryRoutingSolution = {
        routes: knownRoutes,
        stats: {
          routeCount: knownRoutes.length,
          routedCount: knownRoutes.length,
          pendingCount: 0,
          ripCount: 0,
          expandedStateCount: 0,
          viaJumpCount: knownRoutes.length,
          maxHistoryCost: 0,
        },
      }
      assertValidSolution(problem, knownSolution)
    }
  })
})
