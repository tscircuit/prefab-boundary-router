import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { pointDistance, visualizeProblem } from "./geometry"
import type {
  AssignedBoundaryRoutingProblem,
  AssignedViaPair,
  BreakoutPort,
  PreparedBoundaryRoutingProblem,
  ViaPort,
} from "./types"

const EPSILON = 1e-7

interface ViaPairWithPorts extends AssignedViaPair {
  first: ViaPort
  second: ViaPort
}

const collectViaPairs = (
  preparedProblem: PreparedBoundaryRoutingProblem,
): ViaPairWithPorts[] => {
  const viaById = new Map(
    preparedProblem.problem.viaBoundary.ports.map((port) => [
      port.portId,
      port,
    ]),
  )
  const pairs: ViaPairWithPorts[] = []
  for (const first of preparedProblem.problem.viaBoundary.ports) {
    if (first.portId > first.pairedPortId) continue
    const second = viaById.get(first.pairedPortId)!
    pairs.push({
      firstPortId: first.portId,
      secondPortId: second.portId,
      first,
      second,
    })
  }
  return pairs.sort((left, right) =>
    `${left.firstPortId}:${left.secondPortId}`.localeCompare(
      `${right.firstPortId}:${right.secondPortId}`,
    ),
  )
}

const getPortsByRoutedNet = (
  preparedProblem: PreparedBoundaryRoutingProblem,
) => {
  const routedNetIds = new Set(
    preparedProblem.demands.map((demand) => demand.netId),
  )
  const portsByNet = new Map<string, BreakoutPort[]>()
  for (const port of preparedProblem.problem.breakoutBoundary.ports) {
    if (!routedNetIds.has(port.netId)) continue
    const ports = portsByNet.get(port.netId) ?? []
    ports.push(port)
    portsByNet.set(port.netId, ports)
  }
  return [...portsByNet.entries()]
    .map(
      ([netId, ports]) =>
        [
          netId,
          [...ports].sort((left, right) =>
            left.portId.localeCompare(right.portId),
          ),
        ] as const,
    )
    .sort(([left], [right]) => left.localeCompare(right))
}

const directAssignmentCost = (
  ports: BreakoutPort[],
  preparedProblem: PreparedBoundaryRoutingProblem,
) => {
  const breakoutBoundary = preparedProblem.problem.breakoutBoundary
  const sidesForPort = (port: BreakoutPort) => {
    const sides = new Set<string>()
    if (Math.abs(port.x - breakoutBoundary.minX) <= EPSILON) sides.add("left")
    if (Math.abs(port.x - breakoutBoundary.maxX) <= EPSILON) sides.add("right")
    if (Math.abs(port.y - breakoutBoundary.minY) <= EPSILON) sides.add("bottom")
    if (Math.abs(port.y - breakoutBoundary.maxY) <= EPSILON) sides.add("top")
    return sides
  }
  const commonSides = sidesForPort(ports[0]!)
  for (const port of ports.slice(1)) {
    const portSides = sidesForPort(port)
    for (const side of commonSides) {
      if (!portSides.has(side)) commonSides.delete(side)
    }
  }
  // A local direct job is only topologically independent when all terminals
  // share an inner-boundary side. Other nets receive a prefab-via pair.
  if (commonSides.size === 0) return Number.POSITIVE_INFINITY

  const root = ports[0]!
  let cost = 0
  for (const port of ports.slice(1)) {
    cost += pointDistance(root, port)
  }
  return cost
}

export const assignViaBoundaryPoints = (
  preparedProblem: PreparedBoundaryRoutingProblem,
): AssignedBoundaryRoutingProblem => {
  const netEntries = getPortsByRoutedNet(preparedProblem)
  const viaPairs = collectViaPairs(preparedProblem)
  const breakoutPortById = new Map(
    preparedProblem.problem.breakoutBoundary.ports.map((port) => [
      port.portId,
      port,
    ]),
  )
  const viaPairOwnerNetId = new Map<string, string>()
  const pairKey = (pair: ViaPairWithPorts) =>
    `${pair.firstPortId}:${pair.secondPortId}`
  const demandAssignments = preparedProblem.demands.map((demand) => {
    const source = breakoutPortById.get(demand.sourcePortId)!
    const target = breakoutPortById.get(demand.targetPortId)!
    if (
      Number.isFinite(directAssignmentCost([source, target], preparedProblem))
    ) {
      return {
        routeId: demand.routeId,
        netId: demand.netId,
        viaPair: null,
      }
    }

    const candidates = viaPairs
      .filter((pair) => {
        const owner = viaPairOwnerNetId.get(pairKey(pair))
        return !owner || owner === demand.netId
      })
      .flatMap((pair) => {
        const normalCost =
          pointDistance(source, pair.first) + pointDistance(target, pair.second)
        const reverseCost =
          pointDistance(source, pair.second) + pointDistance(target, pair.first)
        return [
          {
            pair,
            sourceViaPortId: pair.firstPortId,
            targetViaPortId: pair.secondPortId,
            cost: normalCost,
          },
          {
            pair,
            sourceViaPortId: pair.secondPortId,
            targetViaPortId: pair.firstPortId,
            cost: reverseCost,
          },
        ]
      })
      .sort(
        (left, right) =>
          left.cost - right.cost ||
          pairKey(left.pair).localeCompare(pairKey(right.pair)) ||
          left.sourceViaPortId.localeCompare(right.sourceViaPortId),
      )
    const selected = candidates[0]
    if (!selected) {
      throw new Error(
        `No via pair remains assignable to route "${demand.routeId}"`,
      )
    }
    viaPairOwnerNetId.set(pairKey(selected.pair), demand.netId)
    return {
      routeId: demand.routeId,
      netId: demand.netId,
      viaPair: {
        firstPortId: selected.pair.firstPortId,
        secondPortId: selected.pair.secondPortId,
      },
      sourceViaPortId: selected.sourceViaPortId,
      targetViaPortId: selected.targetViaPortId,
    }
  })

  const netAssignments = netEntries.map(([netId]) => {
    const netDemandAssignments = demandAssignments.filter(
      (assignment) => assignment.netId === netId,
    )
    const firstPairedAssignment = netDemandAssignments.find(
      (assignment) => assignment.viaPair,
    )
    const viaPortIdByBreakoutPortId = new Map<string, string>()
    for (const assignment of netDemandAssignments) {
      const demand = preparedProblem.demandById.get(assignment.routeId)!
      if (assignment.sourceViaPortId) {
        viaPortIdByBreakoutPortId.set(
          demand.sourcePortId,
          assignment.sourceViaPortId,
        )
      }
      if (assignment.targetViaPortId) {
        viaPortIdByBreakoutPortId.set(
          demand.targetPortId,
          assignment.targetViaPortId,
        )
      }
    }
    return {
      netId,
      viaPair: firstPairedAssignment?.viaPair ?? null,
      viaPortIdByBreakoutPortId,
    }
  })

  return {
    preparedProblem,
    netAssignments,
    netAssignmentById: new Map(
      netAssignments.map((assignment) => [assignment.netId, assignment]),
    ),
    demandAssignments,
    demandAssignmentByRouteId: new Map(
      demandAssignments.map((assignment) => [assignment.routeId, assignment]),
    ),
  }
}

export class ViaBoundaryAssignmentSolver extends BaseSolver {
  private output: AssignedBoundaryRoutingProblem | null = null

  constructor(
    private readonly preparedProblem: PreparedBoundaryRoutingProblem,
  ) {
    super()
    this.MAX_ITERATIONS = 1
  }

  override getConstructorParams(): [PreparedBoundaryRoutingProblem] {
    return [this.preparedProblem]
  }

  override _step() {
    this.output = assignViaBoundaryPoints(this.preparedProblem)
    this.solved = true
    this.progress = 1
  }

  override getOutput() {
    return this.output
  }

  override visualize(): GraphicsObject {
    return visualizeProblem(this.preparedProblem.problem)
  }
}
