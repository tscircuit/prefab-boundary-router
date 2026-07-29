import { expect } from "bun:test"
import {
  type BoundaryRoutingProblem,
  type BoundaryRoutingSolution,
  findDifferentNetGeometryViolations,
  validateBoundaryRoutingSolutionGeometry,
} from "../../lib"

export const assertValidSolution = (
  problem: BoundaryRoutingProblem,
  solution: BoundaryRoutingSolution,
) => {
  const netByPortId = new Map(
    problem.breakoutBoundary.ports.map((port) => [port.portId, port.netId]),
  )
  const adjacencyByNet = new Map<string, Map<string, Set<string>>>()

  expect(() => validateBoundaryRoutingSolutionGeometry(solution)).not.toThrow()
  const traceClearanceViolations = findDifferentNetGeometryViolations(
    solution,
    { clearance: 0.05 },
  ).filter(
    (violation) =>
      violation.type !== "via_trace_clearance" &&
      violation.type !== "via_via_clearance",
  )
  expect(traceClearanceViolations).toHaveLength(0)

  for (const route of solution.routes) {
    const actualBreakoutPortIds = [
      ...new Set(
        route.segments.flatMap((segment) => [
          ...(segment.from.kind === "breakout_port"
            ? [segment.from.nodeId.replace(/^breakout:/, "")]
            : []),
          ...(segment.to.kind === "breakout_port"
            ? [segment.to.nodeId.replace(/^breakout:/, "")]
            : []),
        ]),
      ),
    ]
    expect(actualBreakoutPortIds).toHaveLength(2)
    expect([...actualBreakoutPortIds].sort()).toEqual(
      [route.sourcePortId, route.targetPortId].sort(),
    )
    const [actualSourcePortId, actualTargetPortId] = actualBreakoutPortIds
    expect(netByPortId.get(actualSourcePortId!)).toBe(route.netId)
    expect(netByPortId.get(actualTargetPortId!)).toBe(route.netId)
    const netAdjacency =
      adjacencyByNet.get(route.netId) ?? new Map<string, Set<string>>()
    const sourceNeighbors =
      netAdjacency.get(actualSourcePortId!) ?? new Set<string>()
    const targetNeighbors =
      netAdjacency.get(actualTargetPortId!) ?? new Set<string>()
    sourceNeighbors.add(actualTargetPortId!)
    targetNeighbors.add(actualSourcePortId!)
    netAdjacency.set(actualSourcePortId!, sourceNeighbors)
    netAdjacency.set(actualTargetPortId!, targetNeighbors)
    adjacencyByNet.set(route.netId, netAdjacency)
  }

  for (
    let firstRouteIndex = 0;
    firstRouteIndex < solution.routes.length;
    firstRouteIndex++
  ) {
    for (
      let secondRouteIndex = firstRouteIndex + 1;
      secondRouteIndex < solution.routes.length;
      secondRouteIndex++
    ) {
      const firstRoute = solution.routes[firstRouteIndex]!
      const secondRoute = solution.routes[secondRouteIndex]!
      if (firstRoute.netId === secondRoute.netId) continue
      const sharedViaPortIds = firstRoute.usedViaPortIds.filter((portId) =>
        secondRoute.usedViaPortIds.includes(portId),
      )
      expect(sharedViaPortIds).toHaveLength(0)
    }
  }

  const portsByNet = new Map<string, string[]>()
  for (const port of problem.breakoutBoundary.ports) {
    const portIds = portsByNet.get(port.netId) ?? []
    portIds.push(port.portId)
    portsByNet.set(port.netId, portIds)
  }
  for (const [netId, portIds] of portsByNet) {
    if (portIds.length < 2) continue
    const seen = new Set<string>()
    const stack = [portIds[0]!]
    const adjacency = adjacencyByNet.get(netId) ?? new Map()
    while (stack.length > 0) {
      const portId = stack.pop()!
      if (seen.has(portId)) continue
      seen.add(portId)
      for (const neighbor of adjacency.get(portId) ?? []) {
        stack.push(neighbor)
      }
    }
    expect([...portIds].every((portId) => seen.has(portId))).toBe(true)
  }
}
