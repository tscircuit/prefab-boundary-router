import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  isPointOnRectBoundary,
  pointDistance,
  pointOnSegment,
  pointsEqual,
  rectStrictlyContains,
  segmentIntersectsRectInterior,
  visualizeProblem,
} from "./geometry"
import type {
  BoundaryRoutingProblem,
  BreakoutPort,
  NormalizedBoundaryRoutingOptions,
  Point,
  PreparedBoundaryRoutingProblem,
  RectBounds,
  RouteDemand,
  VectorGraphEdge,
  VectorGraphNode,
} from "./types"

const DEFAULT_OPTIONS: NormalizedBoundaryRoutingOptions = {
  viaJumpCost: 0.25,
  ripCost: 8,
  crossingCost: 0.25,
  historyIncrement: 2,
  maxBlockersPerSearch: 4,
  maxRipsPerRoute: 8,
  maxTotalRips: 100,
  maxSearchStates: 100_000,
  expansionsPerStep: 250,
}

const validateRect = (name: string, rect: RectBounds) => {
  for (const [key, value] of Object.entries(rect)) {
    if (key === "ports") continue
    if (!Number.isFinite(value)) {
      throw new Error(`${name}.${key} must be finite`)
    }
  }
  if (rect.maxX <= rect.minX || rect.maxY <= rect.minY) {
    throw new Error(`${name} must have positive width and height`)
  }
}

const normalizeOptions = (
  problem: BoundaryRoutingProblem,
): NormalizedBoundaryRoutingOptions => {
  const options = { ...DEFAULT_OPTIONS, ...problem.options }
  for (const key of [
    "viaJumpCost",
    "ripCost",
    "historyIncrement",
    "maxBlockersPerSearch",
    "maxRipsPerRoute",
    "maxTotalRips",
    "maxSearchStates",
    "expansionsPerStep",
  ] as const) {
    if (!Number.isFinite(options[key]) || options[key] <= 0) {
      throw new Error(`options.${key} must be greater than zero`)
    }
  }
  if (!Number.isFinite(options.crossingCost) || options.crossingCost < 0) {
    throw new Error("options.crossingCost must be non-negative")
  }

  for (const key of [
    "maxBlockersPerSearch",
    "maxRipsPerRoute",
    "maxTotalRips",
    "maxSearchStates",
    "expansionsPerStep",
  ] as const) {
    options[key] = Math.floor(options[key])
    if (options[key] < 1) {
      throw new Error(`options.${key} must be an integer of at least one`)
    }
  }
  return options
}

export type NetDemandStrategy = "nearest_tree" | "root_star"

export const buildNetDemands = (
  ports: BreakoutPort[],
  portNodeById: Map<string, number>,
  strategy: NetDemandStrategy = "nearest_tree",
) => {
  const portsByNet = new Map<string, BreakoutPort[]>()
  for (const port of ports) {
    const netPorts = portsByNet.get(port.netId) ?? []
    netPorts.push(port)
    portsByNet.set(port.netId, netPorts)
  }

  const orderedNets = [...portsByNet.entries()].sort(
    ([leftNet, leftPorts], [rightNet, rightPorts]) =>
      leftPorts.length - rightPorts.length || leftNet.localeCompare(rightNet),
  )
  const demands: RouteDemand[] = []

  for (const [netId, unsortedPorts] of orderedNets) {
    const netPorts = [...unsortedPorts].sort((a, b) =>
      a.portId.localeCompare(b.portId),
    )
    if (netPorts.length < 2) continue
    if (strategy === "root_star") {
      const sourcePort = netPorts[0]!
      for (const [edgeIndex, targetPort] of netPorts.slice(1).entries()) {
        demands.push({
          routeId: `${netId}:${edgeIndex}:${sourcePort.portId}->${targetPort.portId}`,
          netId,
          sourcePortId: sourcePort.portId,
          targetPortId: targetPort.portId,
          sourceNode: portNodeById.get(sourcePort.portId)!,
          targetNode: portNodeById.get(targetPort.portId)!,
        })
      }
      continue
    }

    const connected = [netPorts[0]!]
    const remaining = netPorts.slice(1)
    let edgeIndex = 0

    while (remaining.length > 0) {
      let bestConnected = connected[0]!
      let bestRemainingIndex = 0
      let bestDistance = Number.POSITIVE_INFINITY
      for (const connectedPort of connected) {
        for (let index = 0; index < remaining.length; index++) {
          const candidate = remaining[index]!
          const distance = pointDistance(connectedPort, candidate)
          if (
            distance < bestDistance ||
            (distance === bestDistance &&
              `${connectedPort.portId}:${candidate.portId}` <
                `${bestConnected.portId}:${remaining[bestRemainingIndex]!.portId}`)
          ) {
            bestConnected = connectedPort
            bestRemainingIndex = index
            bestDistance = distance
          }
        }
      }

      const target = remaining.splice(bestRemainingIndex, 1)[0]!
      demands.push({
        routeId: `${netId}:${edgeIndex++}:${bestConnected.portId}->${target.portId}`,
        netId,
        sourcePortId: bestConnected.portId,
        targetPortId: target.portId,
        sourceNode: portNodeById.get(bestConnected.portId)!,
        targetNode: portNodeById.get(target.portId)!,
      })
      connected.push(target)
    }
  }
  return demands
}

const traceEdgeKey = (first: VectorGraphNode, second: VectorGraphNode) =>
  `trace:${[first.nodeId, second.nodeId].sort().join(":")}`

const viaEdgeKey = (firstPortId: string, secondPortId: string) =>
  `via:${[firstPortId, secondPortId].sort().join(":")}`

const addBidirectionalEdge = (
  adjacency: VectorGraphEdge[][],
  edge: VectorGraphEdge,
) => {
  adjacency[edge.fromNode]!.push(edge)
  adjacency[edge.toNode]!.push(
    edge.kind === "trace"
      ? { ...edge, fromNode: edge.toNode, toNode: edge.fromNode }
      : {
          ...edge,
          fromNode: edge.toNode,
          toNode: edge.fromNode,
          entryPortId: edge.exitPortId,
          exitPortId: edge.entryPortId,
        },
  )
}

export const prepareBoundaryRoutingProblem = (
  problem: BoundaryRoutingProblem,
): PreparedBoundaryRoutingProblem => {
  validateRect("viaBoundary", problem.viaBoundary)
  validateRect("breakoutBoundary", problem.breakoutBoundary)
  if (!rectStrictlyContains(problem.viaBoundary, problem.breakoutBoundary)) {
    throw new Error(
      "viaBoundary must strictly encompass breakoutBoundary on every side",
    )
  }
  const options = normalizeOptions(problem)
  const nodes: VectorGraphNode[] = []
  const breakoutPortNodeById = new Map<string, number>()
  const portLocations: Array<{ point: Point; portId: string }> = []

  for (const port of problem.breakoutBoundary.ports) {
    if (breakoutPortNodeById.has(port.portId)) {
      throw new Error(`Duplicate breakout port id "${port.portId}"`)
    }
    if (!port.netId) {
      throw new Error(`Breakout port "${port.portId}" has no netId`)
    }
    if (!isPointOnRectBoundary(port, problem.breakoutBoundary)) {
      throw new Error(
        `Breakout port "${port.portId}" must lie on breakoutBoundary`,
      )
    }
    const conflictingPort = portLocations.find(({ point }) =>
      pointsEqual(point, port),
    )
    if (conflictingPort) {
      throw new Error(
        `Ports "${conflictingPort.portId}" and "${port.portId}" share a location`,
      )
    }
    const nodeIndex = nodes.length
    nodes.push({
      nodeId: `breakout:${port.portId}`,
      kind: "breakout_port",
      portId: port.portId,
      netId: port.netId,
      x: port.x,
      y: port.y,
    })
    breakoutPortNodeById.set(port.portId, nodeIndex)
    portLocations.push({ point: port, portId: port.portId })
  }

  const viaById = new Map(
    problem.viaBoundary.ports.map((port) => [port.portId, port]),
  )
  if (viaById.size !== problem.viaBoundary.ports.length) {
    throw new Error("Via port ids must be unique")
  }
  const viaPortNodeById = new Map<string, number>()
  for (const port of problem.viaBoundary.ports) {
    if (!isPointOnRectBoundary(port, problem.viaBoundary)) {
      throw new Error(`Via port "${port.portId}" must lie on viaBoundary`)
    }
    const pairedPort = viaById.get(port.pairedPortId)
    if (!pairedPort) {
      throw new Error(
        `Via port "${port.portId}" references missing pair "${port.pairedPortId}"`,
      )
    }
    if (pairedPort.portId === port.portId) {
      throw new Error(`Via port "${port.portId}" cannot pair with itself`)
    }
    if (pairedPort.pairedPortId !== port.portId) {
      throw new Error(
        `Via pairing must be reciprocal: "${port.portId}" and "${pairedPort.portId}"`,
      )
    }
    const conflictingPort = portLocations.find(({ point }) =>
      pointsEqual(point, port),
    )
    if (conflictingPort) {
      throw new Error(
        `Ports "${conflictingPort.portId}" and "${port.portId}" share a location`,
      )
    }
    const nodeIndex = nodes.length
    nodes.push({
      nodeId: `via:${port.portId}`,
      kind: "via_port",
      portId: port.portId,
      x: port.x,
      y: port.y,
    })
    viaPortNodeById.set(port.portId, nodeIndex)
    portLocations.push({ point: port, portId: port.portId })
  }

  const adjacency: VectorGraphEdge[][] = Array.from(
    { length: nodes.length },
    () => [],
  )
  for (let firstIndex = 0; firstIndex < nodes.length; firstIndex++) {
    const first = nodes[firstIndex]!
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < nodes.length;
      secondIndex++
    ) {
      const second = nodes[secondIndex]!
      if (pointsEqual(first, second)) continue
      if (
        segmentIntersectsRectInterior(first, second, problem.breakoutBoundary)
      ) {
        continue
      }
      const passesThroughPort = nodes.some(
        (candidate, candidateIndex) =>
          candidateIndex !== firstIndex &&
          candidateIndex !== secondIndex &&
          (candidate.kind === "breakout_port" ||
            candidate.kind === "via_port") &&
          pointOnSegment(candidate, first, second),
      )
      if (passesThroughPort) continue
      addBidirectionalEdge(adjacency, {
        key: traceEdgeKey(first, second),
        kind: "trace",
        fromNode: firstIndex,
        toNode: secondIndex,
        cost: pointDistance(first, second),
      })
    }
  }

  for (const port of problem.viaBoundary.ports) {
    if (port.portId > port.pairedPortId) continue
    const fromNode = viaPortNodeById.get(port.portId)!
    const toNode = viaPortNodeById.get(port.pairedPortId)!
    addBidirectionalEdge(adjacency, {
      key: viaEdgeKey(port.portId, port.pairedPortId),
      kind: "via_jump",
      fromNode,
      toNode,
      cost: options.viaJumpCost,
      entryPortId: port.portId,
      exitPortId: port.pairedPortId,
    })
  }

  const demands = buildNetDemands(
    problem.breakoutBoundary.ports,
    breakoutPortNodeById,
  )
  return {
    problem,
    options,
    nodes,
    adjacency,
    demands,
    demandById: new Map(demands.map((demand) => [demand.routeId, demand])),
    breakoutPortNodeById,
    viaPortNodeById,
  }
}

export class PrepareBoundaryRoutingProblemSolver extends BaseSolver {
  private output: PreparedBoundaryRoutingProblem | null = null

  constructor(private readonly problem: BoundaryRoutingProblem) {
    super()
    this.MAX_ITERATIONS = 1
  }

  override getConstructorParams(): [BoundaryRoutingProblem] {
    return [this.problem]
  }

  override _step() {
    this.output = prepareBoundaryRoutingProblem(this.problem)
    this.solved = true
    this.progress = 1
  }

  override getOutput() {
    return this.output
  }

  override visualize(): GraphicsObject {
    return visualizeProblem(this.problem)
  }
}
