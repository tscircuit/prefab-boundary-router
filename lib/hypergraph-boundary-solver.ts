import {
  type Candidate,
  type Connection,
  type JPort,
  type JRegion,
  type SolvedRoute,
  ViaGraphSolver,
} from "@tscircuit/hypergraph"
import type { GraphicsObject } from "graphics-debug"
import {
  getViaPairColor,
  getViaPairCurvePoints,
  netColor,
  pointsEqual,
  visualizeProblem,
} from "./geometry"
import { postProcessBoundaryRoutes } from "./post-process-boundary-routes"
import { buildNetDemands } from "./prepare-boundary-routing-problem-solver"
import type {
  BoundaryRoutingSolution,
  Point,
  PreparedBoundaryRoutingProblem,
  RectBounds,
  RouteDemand,
  RoutedConnection,
  RoutedSegment,
  RoutePoint,
} from "./types"

type BoundaryRegionKind =
  | "wedge"
  | "channel"
  | "via_pair"
  | "terminal"
  | "net_target"

interface BoundaryRegion extends JRegion {
  boundaryKind: BoundaryRegionKind
  viaPortIds?: [string, string]
  d: JRegion["d"] & {
    boundaryKind: BoundaryRegionKind
    connectedTerminalIds?: string[]
  }
}

interface BoundaryPort extends JPort {
  positionByRegionId: Record<string, Point>
  d: JPort["d"] & {
    treeTerminalId?: string
  }
}

interface BoundaryConnection extends Connection {
  demand: RouteDemand
  sourceTerminalId: string
}

type QueueItem = { f: number }

class UnboundedPriorityQueue<T extends QueueItem> {
  private heap: T[] = []

  constructor(items: T[] = []) {
    for (const item of items) this.enqueue(item)
  }

  get size() {
    return this.heap.length
  }

  isEmpty() {
    return this.heap.length === 0
  }

  peek() {
    return this.heap[0] ?? null
  }

  peekMany(count: number) {
    return [...this.heap]
      .sort((left, right) => left.f - right.f)
      .slice(0, count)
  }

  enqueue(item: T) {
    this.heap.push(item)
    let index = this.heap.length - 1
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      if (this.heap[parentIndex]!.f <= item.f) break
      this.heap[index] = this.heap[parentIndex]!
      index = parentIndex
    }
    this.heap[index] = item
  }

  dequeue() {
    if (this.heap.length === 0) return null
    const first = this.heap[0]!
    const last = this.heap.pop()!
    if (this.heap.length === 0) return first
    let index = 0
    while (true) {
      const leftIndex = index * 2 + 1
      if (leftIndex >= this.heap.length) break
      const rightIndex = leftIndex + 1
      const childIndex =
        rightIndex < this.heap.length &&
        this.heap[rightIndex]!.f < this.heap[leftIndex]!.f
          ? rightIndex
          : leftIndex
      if (this.heap[childIndex]!.f >= last.f) break
      this.heap[index] = this.heap[childIndex]!
      index = childIndex
    }
    this.heap[index] = last
    return first
  }
}

const boundaryStation = (point: Point, rect: RectBounds) => {
  if (Math.abs(point.y - rect.maxY) < 1e-7) {
    return (point.x - rect.minX) / (rect.maxX - rect.minX)
  }
  if (Math.abs(point.x - rect.maxX) < 1e-7) {
    return 1 + (rect.maxY - point.y) / (rect.maxY - rect.minY)
  }
  if (Math.abs(point.y - rect.minY) < 1e-7) {
    return 2 + (rect.maxX - point.x) / (rect.maxX - rect.minX)
  }
  return 3 + (point.y - rect.minY) / (rect.maxY - rect.minY)
}

const pointAtBoundaryStation = (station: number, rect: RectBounds): Point => {
  if (station < 1) {
    return {
      x: rect.minX + station * (rect.maxX - rect.minX),
      y: rect.maxY,
    }
  }
  if (station < 2) {
    return {
      x: rect.maxX,
      y: rect.maxY - (station - 1) * (rect.maxY - rect.minY),
    }
  }
  if (station < 3) {
    return {
      x: rect.maxX - (station - 2) * (rect.maxX - rect.minX),
      y: rect.minY,
    }
  }
  return {
    x: rect.minX,
    y: rect.minY + (station - 3) * (rect.maxY - rect.minY),
  }
}

const interpolate = (inner: Point, outer: Point, ratio: number): Point => ({
  x: inner.x + (outer.x - inner.x) * ratio,
  y: inner.y + (outer.y - inner.y) * ratio,
})

const createHypergraphInput = (
  preparedProblem: PreparedBoundaryRoutingProblem,
  laneCount: number,
) => {
  const { problem } = preparedProblem
  const stations = [
    ...new Map(
      [
        0,
        1,
        2,
        3,
        4,
        ...problem.breakoutBoundary.ports.map((port) =>
          boundaryStation(port, problem.breakoutBoundary),
        ),
        ...problem.viaBoundary.ports.map((port) =>
          boundaryStation(port, problem.viaBoundary),
        ),
      ].map((station) => [station.toFixed(12), station] as const),
    ).values(),
  ].sort((left, right) => left - right)
  const stationIndexByKey = new Map(
    stations.map((station, index) => [station.toFixed(12), index]),
  )
  const regions: BoundaryRegion[] = []
  const ports: BoundaryPort[] = []

  const createRegion = (
    regionId: string,
    polygon: Point[],
    boundaryKind: BoundaryRegionKind,
  ) => {
    const xs = polygon.map((point) => point.x)
    const ys = polygon.map((point) => point.y)
    const bounds = {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    }
    const region: BoundaryRegion = {
      regionId,
      ports: [],
      boundaryKind,
      d: {
        bounds,
        center: {
          x: (bounds.minX + bounds.maxX) / 2,
          y: (bounds.minY + bounds.maxY) / 2,
        },
        polygon,
        isPad: false,
        isViaRegion: boundaryKind === "channel" || boundaryKind === "via_pair",
        isConnectionRegion:
          boundaryKind === "terminal" || boundaryKind === "net_target",
        boundaryKind,
      },
    }
    regions.push(region)
    return region
  }

  const createPort = (
    portId: string,
    region1: BoundaryRegion,
    region2: BoundaryRegion,
    region1Position: Point,
    region2Position = region1Position,
  ) => {
    const port: BoundaryPort = {
      portId,
      region1,
      region2,
      d: { ...region1Position },
      positionByRegionId: {
        [region1.regionId]: region1Position,
        [region2.regionId]: region2Position,
      },
    }
    region1.ports.push(port)
    region2.ports.push(port)
    ports.push(port)
    return port
  }

  const wedgeRegions: BoundaryRegion[] = []
  for (let index = 0; index < stations.length - 1; index++) {
    const startStation = stations[index]!
    const endStation = stations[index + 1]!
    wedgeRegions.push(
      createRegion(
        `wedge:${index}`,
        [
          pointAtBoundaryStation(startStation, problem.breakoutBoundary),
          pointAtBoundaryStation(endStation, problem.breakoutBoundary),
          pointAtBoundaryStation(endStation, problem.viaBoundary),
          pointAtBoundaryStation(startStation, problem.viaBoundary),
        ],
        "wedge",
      ),
    )
  }

  for (let seamIndex = 0; seamIndex < wedgeRegions.length; seamIndex++) {
    const station = stations[seamIndex]!
    const before =
      wedgeRegions[(seamIndex - 1 + wedgeRegions.length) % wedgeRegions.length]!
    const after = wedgeRegions[seamIndex]!
    const innerPoint = pointAtBoundaryStation(station, problem.breakoutBoundary)
    const outerPoint = pointAtBoundaryStation(station, problem.viaBoundary)
    for (let laneIndex = 0; laneIndex < laneCount; laneIndex++) {
      const position = interpolate(
        innerPoint,
        outerPoint,
        (laneIndex + 1) / (laneCount + 1),
      )
      const epsilon = 1e-4
      const channel = createRegion(
        `channel:${seamIndex}:${laneIndex}`,
        [
          { x: position.x - epsilon, y: position.y - epsilon },
          { x: position.x + epsilon, y: position.y - epsilon },
          { x: position.x + epsilon, y: position.y + epsilon },
          { x: position.x - epsilon, y: position.y + epsilon },
        ],
        "channel",
      )
      createPort(
        `channel:${seamIndex}:${laneIndex}:before`,
        before,
        channel,
        position,
      )
      createPort(
        `channel:${seamIndex}:${laneIndex}:after`,
        channel,
        after,
        position,
      )
    }
  }

  const wedgeAfterPoint = (point: Point, rect: RectBounds) => {
    const stationIndex = stationIndexByKey.get(
      boundaryStation(point, rect).toFixed(12),
    )!
    return wedgeRegions[
      stationIndex === wedgeRegions.length ? 0 : stationIndex
    ]!
  }

  const terminalRegionByPortId = new Map<string, BoundaryRegion>()
  for (const breakoutPort of problem.breakoutBoundary.ports) {
    const position = { x: breakoutPort.x, y: breakoutPort.y }
    const epsilon = 1e-4
    const terminal = createRegion(
      `terminal:${breakoutPort.portId}`,
      [
        { x: position.x - epsilon, y: position.y - epsilon },
        { x: position.x + epsilon, y: position.y - epsilon },
        { x: position.x + epsilon, y: position.y + epsilon },
        { x: position.x - epsilon, y: position.y + epsilon },
      ],
      "terminal",
    )
    terminalRegionByPortId.set(breakoutPort.portId, terminal)
    createPort(
      `terminal-port:${breakoutPort.portId}`,
      terminal,
      wedgeAfterPoint(breakoutPort, problem.breakoutBoundary),
      position,
    )
  }

  const rootStarDemands = buildNetDemands(
    problem.breakoutBoundary.ports,
    preparedProblem.breakoutPortNodeById,
    "root_star",
  )
  const netTargetRegionByNetId = new Map<string, BoundaryRegion>()
  const portsByNetId = Map.groupBy(
    problem.breakoutBoundary.ports,
    (port) => port.netId,
  )
  for (const [netId, unsortedNetPorts] of portsByNetId) {
    if (unsortedNetPorts.length < 2) continue
    const netPorts = [...unsortedNetPorts].sort((left, right) =>
      left.portId.localeCompare(right.portId),
    )
    const target = createRegion(
      `net-target:${netId}`,
      [
        { x: 0, y: 0 },
        { x: 1e-4, y: 0 },
        { x: 1e-4, y: 1e-4 },
        { x: 0, y: 1e-4 },
      ],
      "net_target",
    )
    target.d.connectedTerminalIds = [netPorts[0]!.portId]
    netTargetRegionByNetId.set(netId, target)
    for (const netPort of netPorts) {
      const targetPort = createPort(
        `net-target-port:${netId}:${netPort.portId}`,
        terminalRegionByPortId.get(netPort.portId)!,
        target,
        netPort,
      )
      targetPort.d.treeTerminalId = netPort.portId
    }
  }

  const viaPortById = new Map(
    problem.viaBoundary.ports.map((port) => [port.portId, port]),
  )
  for (const firstViaPort of problem.viaBoundary.ports) {
    if (firstViaPort.portId > firstViaPort.pairedPortId) continue
    const secondViaPort = viaPortById.get(firstViaPort.pairedPortId)!
    const firstPosition = { x: firstViaPort.x, y: firstViaPort.y }
    const secondPosition = { x: secondViaPort.x, y: secondViaPort.y }
    const epsilon = 1e-4
    const viaRegion = createRegion(
      `via-pair:${firstViaPort.portId}:${secondViaPort.portId}`,
      [
        { x: firstPosition.x - epsilon, y: firstPosition.y - epsilon },
        { x: firstPosition.x + epsilon, y: firstPosition.y + epsilon },
        { x: secondPosition.x + epsilon, y: secondPosition.y + epsilon },
        { x: secondPosition.x - epsilon, y: secondPosition.y - epsilon },
      ],
      "via_pair",
    )
    viaRegion.viaPortIds = [firstViaPort.portId, secondViaPort.portId]
    createPort(
      `via-pair-port:${firstViaPort.portId}`,
      wedgeAfterPoint(firstViaPort, problem.viaBoundary),
      viaRegion,
      firstPosition,
    )
    createPort(
      `via-pair-port:${secondViaPort.portId}`,
      viaRegion,
      wedgeAfterPoint(secondViaPort, problem.viaBoundary),
      secondPosition,
    )
  }

  const connections = rootStarDemands.map(
    (demand): BoundaryConnection => ({
      connectionId: demand.routeId,
      mutuallyConnectedNetworkId: demand.netId,
      startRegion: terminalRegionByPortId.get(demand.targetPortId)!,
      endRegion: netTargetRegionByNetId.get(demand.netId)!,
      demand,
      sourceTerminalId: demand.targetPortId,
    }),
  )
  return { graph: { regions, ports }, connections, rootStarDemands }
}

export class HypergraphBoundarySolver extends ViaGraphSolver {
  private readonly preparedProblem: PreparedBoundaryRoutingProblem
  private readonly demandByConnectionId: Map<string, RouteDemand>
  private cachedFinalOutput: BoundaryRoutingSolution | null = null
  private totalRipCount = 0

  constructor(preparedProblem: PreparedBoundaryRoutingProblem) {
    const { graph, connections, rootStarDemands } = createHypergraphInput(
      preparedProblem,
      8,
    )
    super({
      inputGraph: graph,
      inputConnections: connections,
      baseMaxIterations: 1_500_000,
      additionalMaxIterationsPerConnection: 5_000,
      ripCost: 100,
      crossingPenalty: 1_000_000,
      portUsagePenalty: 10,
    })
    this.preparedProblem = preparedProblem
    this.demandByConnectionId = new Map(
      rootStarDemands.map((demand) => [demand.routeId, demand]),
    )
  }

  override getSolverName() {
    return "HypergraphBoundarySolver"
  }

  override beginNewConnection() {
    super.beginNewConnection()
    const connection = this.currentConnection as BoundaryConnection
    const initialCandidates = this.candidateQueue
      .peekMany(this.candidateQueue.size)
      .filter((candidate) => {
        const port = candidate.port as BoundaryPort
        const targetTerminalId = port.d.treeTerminalId
        if (!targetTerminalId) return true
        const targetRegion =
          (port.region1 as BoundaryRegion).boundaryKind === "net_target"
            ? (port.region1 as BoundaryRegion)
            : (port.region2 as BoundaryRegion).boundaryKind === "net_target"
              ? (port.region2 as BoundaryRegion)
              : null
        return (
          targetRegion === this.currentEndRegion &&
          Boolean(
            targetRegion?.d.connectedTerminalIds?.includes(targetTerminalId),
          )
        )
      })
    this.candidateQueue = new UnboundedPriorityQueue(
      initialCandidates,
    ) as unknown as typeof this.candidateQueue
    void connection
  }

  override isTransitionAllowed(region: JRegion, port1: JPort, port2: JPort) {
    const boundaryRegion = region as BoundaryRegion
    if (boundaryRegion.boundaryKind === "net_target") return false
    const targetTerminalId = (port2 as BoundaryPort).d.treeTerminalId
    if (!targetTerminalId) {
      return super.isTransitionAllowed(region, port1, port2)
    }
    const targetRegion =
      (port2.region1 as BoundaryRegion).boundaryKind === "net_target"
        ? (port2.region1 as BoundaryRegion)
        : (port2.region2 as BoundaryRegion).boundaryKind === "net_target"
          ? (port2.region2 as BoundaryRegion)
          : null
    return (
      targetRegion === this.currentEndRegion &&
      Boolean(targetRegion?.d.connectedTerminalIds?.includes(targetTerminalId))
    )
  }

  override routeSolvedHook(solvedRoute: SolvedRoute) {
    const connection = solvedRoute.connection as BoundaryConnection
    const targetRegion = connection.endRegion as BoundaryRegion
    targetRegion.d.connectedTerminalIds ??= []
    if (
      !targetRegion.d.connectedTerminalIds.includes(connection.sourceTerminalId)
    ) {
      targetRegion.d.connectedTerminalIds.push(connection.sourceTerminalId)
    }
  }

  override ripSolvedRoute(solvedRoute: SolvedRoute) {
    if (!this.solvedRoutes.includes(solvedRoute)) return
    this.totalRipCount++
    const remainingRoutes = this.solvedRoutes.filter(
      (route) => route !== solvedRoute,
    )
    const rippedPorts = new Set(
      solvedRoute.path.map((candidate) => candidate.port),
    )
    for (const port of rippedPorts) {
      port.ripCount = (port.ripCount ?? 0) + 1
    }
    for (const region of this.graph.regions) {
      region.assignments = region.assignments?.filter(
        (assignment) => assignment.solvedRoute !== solvedRoute,
      )
    }
    for (const port of rippedPorts) {
      const replacementRoute = remainingRoutes.find((route) =>
        route.path.some((candidate) => candidate.port === port),
      )
      port.assignment = replacementRoute
        ? {
            solvedRoute: replacementRoute,
            connection: replacementRoute.connection,
          }
        : undefined
    }
    this.solvedRoutes = remainingRoutes
    if (!this.unprocessedConnections.includes(solvedRoute.connection)) {
      this.unprocessedConnections.push(solvedRoute.connection)
    }
  }

  private getPortPosition(port: BoundaryPort, region: BoundaryRegion) {
    return port.positionByRegionId[region.regionId]!
  }

  private toRoutePoint(point: Point): RoutePoint {
    const breakoutPort =
      this.preparedProblem.problem.breakoutBoundary.ports.find((port) =>
        pointsEqual(port, point),
      )
    if (breakoutPort) {
      return {
        nodeId: `breakout:${breakoutPort.portId}`,
        kind: "breakout_port",
        x: point.x,
        y: point.y,
      }
    }
    const viaPort = this.preparedProblem.problem.viaBoundary.ports.find(
      (port) => pointsEqual(port, point),
    )
    if (viaPort) {
      return {
        nodeId: `via:${viaPort.portId}`,
        kind: "via_port",
        x: point.x,
        y: point.y,
      }
    }
    return {
      nodeId: `routing:${point.x}:${point.y}`,
      kind: "routing_point",
      x: point.x,
      y: point.y,
    }
  }

  private convertSolvedRoute(solvedRoute: SolvedRoute): RoutedConnection {
    const demand = this.demandByConnectionId.get(
      solvedRoute.connection.connectionId,
    )!
    const path = solvedRoute.path as Candidate<BoundaryRegion, BoundaryPort>[]
    const segments: RoutedSegment[] = []
    const usedViaPortIds: string[] = []
    for (let index = 1; index < path.length; index++) {
      const previous = path[index - 1]!
      const current = path[index]!
      const region = current.lastRegion!
      const fromPoint = this.getPortPosition(previous.port, region)
      const toPoint = this.getPortPosition(current.port, region)
      if (region.boundaryKind === "net_target") continue
      if (region.boundaryKind === "via_pair") {
        const [entryPortId, exitPortId] = region.viaPortIds!
        usedViaPortIds.push(entryPortId, exitPortId)
        segments.push({
          kind: "via_jump",
          edgeKey: region.regionId,
          from: this.toRoutePoint(fromPoint),
          to: this.toRoutePoint(toPoint),
          entryPortId,
          exitPortId,
        })
        continue
      }
      if (pointsEqual(fromPoint, toPoint)) continue
      segments.push({
        kind: "trace",
        edgeKey: `${region.regionId}:${previous.port.portId}:${current.port.portId}`,
        from: this.toRoutePoint(fromPoint),
        to: this.toRoutePoint(toPoint),
      })
    }
    return {
      routeId: demand.routeId,
      netId: demand.netId,
      sourcePortId: demand.sourcePortId,
      targetPortId: demand.targetPortId,
      points: segments.flatMap((segment) => [segment.from, segment.to]),
      segments,
      usedViaPortIds: [...new Set(usedViaPortIds)],
    }
  }

  override getOutput(): BoundaryRoutingSolution {
    if (this.cachedFinalOutput) return this.cachedFinalOutput
    const rawRoutes = this.solvedRoutes.map((route) =>
      this.convertSolvedRoute(route),
    )
    const routes = this.solved
      ? postProcessBoundaryRoutes(this.preparedProblem.problem, rawRoutes)
      : rawRoutes
    const viaJumpCount = routes.reduce(
      (total, route) =>
        total +
        route.segments.filter((segment) => segment.kind === "via_jump").length,
      0,
    )
    const output = {
      routes,
      stats: {
        routeCount: this.connections.length,
        routedCount: routes.length,
        pendingCount:
          this.unprocessedConnections.length +
          (this.solved || this.failed ? 0 : 1),
        ripCount: this.totalRipCount,
        expandedStateCount: this.iterations,
        viaJumpCount,
        maxHistoryCost: Math.max(
          0,
          ...this.graph.ports.map((port) => (port.ripCount ?? 0) * 10),
        ),
      },
    }
    if (this.solved) this.cachedFinalOutput = output
    return output
  }

  override visualize(): GraphicsObject {
    const initial = visualizeProblem(this.preparedProblem.problem)
    const lines = [...(initial.lines ?? [])]
    for (const route of this.getOutput().routes) {
      for (const segment of route.segments) {
        if (segment.kind === "trace") {
          lines.push({
            points: [segment.from, segment.to],
            strokeColor: netColor(route.netId),
            strokeWidth: 0.18,
          })
        } else {
          lines.push({
            points: getViaPairCurvePoints(
              this.preparedProblem.problem,
              segment.entryPortId,
              segment.exitPortId,
            ),
            strokeColor: getViaPairColor(
              this.preparedProblem.problem,
              segment.entryPortId,
              segment.exitPortId,
            ),
            strokeWidth: 0.14,
            strokeDash: "5 2",
          })
        }
      }
    }
    return {
      ...initial,
      title: `Global hypergraph routing (${this.solvedRoutes.length}/${this.connections.length} routes)`,
      lines,
    }
  }
}
