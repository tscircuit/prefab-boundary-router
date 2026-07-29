import { describe, expect, test } from "bun:test"
import datasetJson from "../benchmarks/datasets/production-double-breakout-boundary-problems.json"
import {
  DOUBLE_BREAKOUT_POWER_NET_PORT_COUNT,
  DOUBLE_BREAKOUT_PRODUCTION_BREAKOUT_PORT_COUNT,
  DOUBLE_BREAKOUT_PRODUCTION_NET_COUNT,
  DOUBLE_BREAKOUT_PRODUCTION_ROUTE_DEMAND_COUNT,
  DOUBLE_BREAKOUT_PRODUCTION_SAMPLE_COUNT,
  DOUBLE_BREAKOUT_PRODUCTION_VIA_COUNT,
  DOUBLE_BREAKOUT_SIGNAL_NET_COUNT,
  DOUBLE_BREAKOUT_SINGLE_PORT_SIGNAL_NET_COUNT,
  DOUBLE_BREAKOUT_TWO_PORT_SIGNAL_NET_COUNT,
  generateDoubleBreakoutProductionStressDataset,
  type ProductionStressProblemDataset,
} from "../benchmarks/production-stress-dataset"
import {
  type BoundaryRoutingSolution,
  prepareBoundaryRoutingProblem,
  type RoutedConnection,
} from "../lib"
import { assertValidSolution } from "./fixtures/assert-valid-solution"

const dataset = datasetJson as ProductionStressProblemDataset

describe("double-breakout production stress dataset", () => {
  test("matches the deterministic generator", () => {
    expect(dataset).toEqual(generateDoubleBreakoutProductionStressDataset())
  })

  test("doubles the production profile and includes a valid route certificate", () => {
    expect(dataset.cases).toHaveLength(DOUBLE_BREAKOUT_PRODUCTION_SAMPLE_COUNT)
    expect(dataset.minimumSolvePercent).toBe(100)
    expect(dataset.profile).toEqual({
      viaCount: DOUBLE_BREAKOUT_PRODUCTION_VIA_COUNT,
      breakoutPortCount: DOUBLE_BREAKOUT_PRODUCTION_BREAKOUT_PORT_COUNT,
      netCount: DOUBLE_BREAKOUT_PRODUCTION_NET_COUNT,
      powerNetPortCounts: {
        VCC: DOUBLE_BREAKOUT_POWER_NET_PORT_COUNT,
        GND: DOUBLE_BREAKOUT_POWER_NET_PORT_COUNT,
      },
      twoPortSignalNetCount: DOUBLE_BREAKOUT_TWO_PORT_SIGNAL_NET_COUNT,
      singlePortSignalNetCount: DOUBLE_BREAKOUT_SINGLE_PORT_SIGNAL_NET_COUNT,
    })

    for (const problemCase of dataset.cases) {
      const { problem } = problemCase
      expect(problem.breakoutBoundary.ports).toHaveLength(
        DOUBLE_BREAKOUT_PRODUCTION_BREAKOUT_PORT_COUNT,
      )
      expect(problem.viaBoundary.ports).toHaveLength(
        DOUBLE_BREAKOUT_PRODUCTION_VIA_COUNT,
      )
      expect(
        new Set(problem.breakoutBoundary.ports.map((port) => port.netId)).size,
      ).toBe(DOUBLE_BREAKOUT_PRODUCTION_NET_COUNT)
      expect(
        problem.breakoutBoundary.ports.filter(
          (port) => port.netId !== "VCC" && port.netId !== "GND",
        ),
      ).toHaveLength(
        DOUBLE_BREAKOUT_SIGNAL_NET_COUNT +
          DOUBLE_BREAKOUT_TWO_PORT_SIGNAL_NET_COUNT,
      )

      const preparedProblem = prepareBoundaryRoutingProblem(problem)
      expect(preparedProblem.demands).toHaveLength(
        DOUBLE_BREAKOUT_PRODUCTION_ROUTE_DEMAND_COUNT,
      )
      expect(problemCase.knownRoutePlan).toHaveLength(
        DOUBLE_BREAKOUT_PRODUCTION_ROUTE_DEMAND_COUNT,
      )

      const breakoutPortById = new Map(
        problem.breakoutBoundary.ports.map((port) => [port.portId, port]),
      )
      const viaByPortId = new Map(
        problem.viaBoundary.ports.map((port) => [port.portId, port]),
      )
      const knownRoutes: RoutedConnection[] = problemCase.knownRoutePlan.map(
        (connection, connectionIndex) => {
          const sourcePort = breakoutPortById.get(connection.sourcePortId)!
          const targetPort = breakoutPortById.get(connection.targetPortId)!
          const entryViaPort = viaByPortId.get(connection.entryViaPortId)!
          const exitViaPort = viaByPortId.get(connection.exitViaPortId)!
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
