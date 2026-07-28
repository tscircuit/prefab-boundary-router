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

const buildNetDemands = (
  ports: BreakoutPort[],
  portNodeById: Map<string, number>,
) => {
  const portsByNet = new Map<string, BreakoutPort[]>()
  for (const port of ports) {
    const netPorts = portsByNet.get(port.netId) ?? []
    netPorts.push(port)
    portsByNet.set(port.netId, netPorts)
  }

  const orderedNets = [...portsByNet.entries()].sort(
    ([leftNet, leftPorts], [rightNet, rightPorts]) =>
      rightPorts.length - leftPorts.length || leftNet.localeCompare(rightNet),
  )
  const demands: RouteDemand[] = []

  for (const [netId, unsortedPorts] of orderedNets) {
    const netPorts = [...unsortedPorts].sort((a, b) => a.id.localeCompare(b.id))
    if (netPorts.length < 2) continue
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
              `${connectedPort.id}:${candidate.id}` <
                `${bestConnected.id}:${remaining[bestRemainingIndex]!.id}`)
          ) {
            bestConnected = connectedPort
            bestRemainingIndex = index
            bestDistance = distance
          }
        }
      }

      const target = remaining.splice(bestRemainingIndex, 1)[0]!
      demands.push({
        id: `${netId}:${edgeIndex++}:${bestConnected.id}->${target.id}`,
        netId,
        sourcePortId: bestConnected.id,
        targetPortId: target.id,
        sourceNode: portNodeById.get(bestConnected.id)!,
        targetNode: portNodeById.get(target.id)!,
      })
      connected.push(target)
    }
  }
  return demands
}

const traceEdgeKey = (first: VectorGraphNode, second: VectorGraphNode) =>
  `trace:${[first.id, second.id].sort().join(":")}`

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
  const portLocations: Array<{ point: Point; id: string }> = []

  for (const port of problem.breakoutBoundary.ports) {
    if (breakoutPortNodeById.has(port.id)) {
      throw new Error(`Duplicate breakout port id "${port.id}"`)
    }
    if (!port.netId) throw new Error(`Breakout port "${port.id}" has no netId`)
    if (!isPointOnRectBoundary(port, problem.breakoutBoundary)) {
      throw new Error(`Breakout port "${port.id}" must lie on breakoutBoundary`)
    }
    const conflictingPort = portLocations.find(({ point }) =>
      pointsEqual(point, port),
    )
    if (conflictingPort) {
      throw new Error(
        `Ports "${conflictingPort.id}" and "${port.id}" share a location`,
      )
    }
    const nodeIndex = nodes.length
    nodes.push({
      id: `breakout:${port.id}`,
      kind: "breakout_port",
      portId: port.id,
      netId: port.netId,
      x: port.x,
      y: port.y,
    })
    breakoutPortNodeById.set(port.id, nodeIndex)
    portLocations.push({ point: port, id: port.id })
  }

  const viaById = new Map(
    problem.viaBoundary.ports.map((port) => [port.id, port]),
  )
  if (viaById.size !== problem.viaBoundary.ports.length) {
    throw new Error("Via port ids must be unique")
  }
  const viaPortNodeById = new Map<string, number>()
  for (const port of problem.viaBoundary.ports) {
    if (!isPointOnRectBoundary(port, problem.viaBoundary)) {
      throw new Error(`Via port "${port.id}" must lie on viaBoundary`)
    }
    const pairedPort = viaById.get(port.pairedPortId)
    if (!pairedPort) {
      throw new Error(
        `Via port "${port.id}" references missing pair "${port.pairedPortId}"`,
      )
    }
    if (pairedPort.id === port.id) {
      throw new Error(`Via port "${port.id}" cannot pair with itself`)
    }
    if (pairedPort.pairedPortId !== port.id) {
      throw new Error(
        `Via pairing must be reciprocal: "${port.id}" and "${pairedPort.id}"`,
      )
    }
    const conflictingPort = portLocations.find(({ point }) =>
      pointsEqual(point, port),
    )
    if (conflictingPort) {
      throw new Error(
        `Ports "${conflictingPort.id}" and "${port.id}" share a location`,
      )
    }
    const nodeIndex = nodes.length
    nodes.push({
      id: `via:${port.id}`,
      kind: "via_port",
      portId: port.id,
      x: port.x,
      y: port.y,
    })
    viaPortNodeById.set(port.id, nodeIndex)
    portLocations.push({ point: port, id: port.id })
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
    if (port.id > port.pairedPortId) continue
    const fromNode = viaPortNodeById.get(port.id)!
    const toNode = viaPortNodeById.get(port.pairedPortId)!
    addBidirectionalEdge(adjacency, {
      key: viaEdgeKey(port.id, port.pairedPortId),
      kind: "via_jump",
      fromNode,
      toNode,
      cost: options.viaJumpCost,
      entryPortId: port.id,
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
    demandById: new Map(demands.map((demand) => [demand.id, demand])),
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
