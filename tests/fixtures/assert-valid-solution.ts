import { expect } from "bun:test"
import type { BoundaryRoutingProblem, BoundaryRoutingSolution } from "../../lib"
import { segmentsIntersect } from "../../lib/geometry"

export const assertValidSolution = (
  problem: BoundaryRoutingProblem,
  solution: BoundaryRoutingSolution,
) => {
  const netByPortId = new Map(
    problem.breakoutBoundary.ports.map((port) => [port.portId, port.netId]),
  )
  const adjacencyByNet = new Map<string, Map<string, Set<string>>>()

  for (const route of solution.routes) {
    expect(netByPortId.get(route.sourcePortId)).toBe(route.netId)
    expect(netByPortId.get(route.targetPortId)).toBe(route.netId)
    const netAdjacency =
      adjacencyByNet.get(route.netId) ?? new Map<string, Set<string>>()
    const sourceNeighbors =
      netAdjacency.get(route.sourcePortId) ?? new Set<string>()
    const targetNeighbors =
      netAdjacency.get(route.targetPortId) ?? new Set<string>()
    sourceNeighbors.add(route.targetPortId)
    targetNeighbors.add(route.sourcePortId)
    netAdjacency.set(route.sourcePortId, sourceNeighbors)
    netAdjacency.set(route.targetPortId, targetNeighbors)
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
      for (const firstSegment of firstRoute.segments) {
        if (firstSegment.kind !== "trace") continue
        for (const secondSegment of secondRoute.segments) {
          if (secondSegment.kind !== "trace") continue
          expect(
            segmentsIntersect(
              firstSegment.from,
              firstSegment.to,
              secondSegment.from,
              secondSegment.to,
            ),
          ).toBe(false)
        }
      }
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
