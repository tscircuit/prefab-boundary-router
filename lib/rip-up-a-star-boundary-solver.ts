import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  getViaPairColor,
  getViaPairCurvePoints,
  netColor,
  segmentsIntersect,
  visualizeProblem,
} from "./geometry"
import { MinHeap } from "./min-heap"
import { buildNetDemands } from "./prepare-boundary-routing-problem-solver"
import type {
  BoundaryRoutingSolution,
  BoundaryRoutingStats,
  PreparedBoundaryRoutingProblem,
  RouteDemand,
  RoutedConnection,
  RoutedSegment,
  VectorGraphEdge,
} from "./types"

interface SearchNode {
  graphNode: number
  g: number
  parentIndex: number
  blockers: string[]
  edgeFromParent: VectorGraphEdge | null
}

interface ActiveSearch {
  demand: RouteDemand
  nodes: SearchNode[]
  open: MinHeap<number>
  bestCostByState: Map<string, number>
  heuristic: Float64Array
  expanded: number
}

const stateKey = (graphNode: number, blockers: readonly string[]) =>
  `${graphNode}|${blockers.join(",")}`

const insertSortedUnique = (values: readonly string[], additions: string[]) =>
  [...new Set([...values, ...additions])].sort()

class SingleAttemptRipUpAStarBoundarySolver extends BaseSolver {
  private readonly viaOwners = new Map<string, Set<string>>()
  private readonly historyCostByEdge = new Map<string, number>()
  private readonly committed = new Map<string, RoutedConnection>()
  private readonly pending: RouteDemand[]
  private readonly ripCountByRoute = new Map<string, number>()
  private activeSearch: ActiveSearch | null = null
  private totalRipCount = 0
  private totalExpandedStateCount = 0

  constructor(
    private readonly preparedProblem: PreparedBoundaryRoutingProblem,
  ) {
    super()
    this.pending = [...preparedProblem.demands]
    const maximumRoutingAttempts =
      preparedProblem.demands.length + preparedProblem.options.maxTotalRips + 1
    const stepsPerSearch = Math.ceil(
      preparedProblem.options.maxSearchStates /
        preparedProblem.options.expansionsPerStep,
    )
    this.MAX_ITERATIONS = Math.max(
      1000,
      maximumRoutingAttempts * (stepsPerSearch + 2),
    )
    this.updateStats()
  }

  override getSolverName() {
    return "RipUpAStarBoundarySolver"
  }

  override getConstructorParams(): [PreparedBoundaryRoutingProblem] {
    return [this.preparedProblem]
  }

  get activeDemand() {
    return this.activeSearch?.demand ?? null
  }

  get committedRoutes() {
    return new Map(this.committed)
  }

  get pendingRouteIds() {
    return this.pending.map((demand) => demand.routeId)
  }

  override _step() {
    if (!this.activeSearch) {
      const demand = this.pending.shift()
      if (!demand) {
        this.validateFinalGeometry()
        this.solved = true
        this.progress = 1
        this.updateStats()
        return
      }
      this.activeSearch = this.createSearch(demand)
    }

    for (
      let expansion = 0;
      expansion < this.preparedProblem.options.expansionsPerStep;
      expansion++
    ) {
      if (!this.activeSearch || this.solved || this.failed) break
      this.expandOneState()
    }
    this.progress = this.computeProgress()
    this.updateStats()
  }

  computeProgress() {
    const routeCount = this.preparedProblem.demands.length
    return routeCount === 0 ? 1 : this.committed.size / routeCount
  }

  private createSearch(demand: RouteDemand): ActiveSearch {
    const heuristic = this.computeUncongestedDistanceTo(demand.targetNode)
    if (!Number.isFinite(heuristic[demand.sourceNode])) {
      throw new Error(
        `No vector path exists for route "${demand.routeId}" before considering congestion`,
      )
    }
    const open = new MinHeap<number>()
    open.push(heuristic[demand.sourceNode]!, 0)
    return {
      demand,
      nodes: [
        {
          graphNode: demand.sourceNode,
          g: 0,
          parentIndex: -1,
          blockers: [],
          edgeFromParent: null,
        },
      ],
      open,
      bestCostByState: new Map([[stateKey(demand.sourceNode, []), 0]]),
      heuristic,
      expanded: 0,
    }
  }

  private expandOneState() {
    const search = this.activeSearch
    if (!search) return
    const searchNodeIndex = search.open.pop()
    if (searchNodeIndex === undefined) {
      this.failActiveSearch(
        `No route found for "${search.demand.routeId}" with at most ${this.preparedProblem.options.maxBlockersPerSearch} ripped blockers`,
      )
      return
    }

    const searchNode = search.nodes[searchNodeIndex]!
    const bestCost = search.bestCostByState.get(
      stateKey(searchNode.graphNode, searchNode.blockers),
    )
    if (bestCost === undefined || searchNode.g > bestCost + 1e-9) return

    search.expanded++
    this.totalExpandedStateCount++
    if (searchNode.graphNode === search.demand.targetNode) {
      this.commitGoal(search, searchNodeIndex)
      return
    }
    if (search.nodes.length >= this.preparedProblem.options.maxSearchStates) {
      this.failActiveSearch(
        `A* state limit (${this.preparedProblem.options.maxSearchStates}) reached for "${search.demand.routeId}"`,
      )
      return
    }

    for (const edge of this.preparedProblem.adjacency[searchNode.graphNode]!) {
      this.considerEdge(search, searchNodeIndex, edge)
    }
  }

  private considerEdge(
    search: ActiveSearch,
    parentIndex: number,
    edge: VectorGraphEdge,
  ) {
    const parent = search.nodes[parentIndex]!
    const nextGraphNode = this.preparedProblem.nodes[edge.toNode]!
    if (
      nextGraphNode.kind === "breakout_port" &&
      nextGraphNode.netId !== search.demand.netId
    ) {
      return
    }
    if (this.pathContainsGraphNode(search.nodes, parentIndex, edge.toNode)) {
      return
    }
    if (
      edge.kind === "trace" &&
      this.edgeIntersectsEarlierPath(search.nodes, parentIndex, edge)
    ) {
      return
    }

    const foreignOwners = this.getForeignOwners(edge, search.demand.netId)
    for (const ownerRouteId of foreignOwners) {
      const ownerRipCount = this.ripCountByRoute.get(ownerRouteId) ?? 0
      if (
        ownerRipCount >= this.preparedProblem.options.maxRipsPerRoute ||
        !this.committed.has(ownerRouteId)
      ) {
        return
      }
    }

    const nextBlockers = insertSortedUnique(parent.blockers, foreignOwners)
    if (
      nextBlockers.length > this.preparedProblem.options.maxBlockersPerSearch
    ) {
      return
    }
    const newlyAddedBlockers = nextBlockers.length - parent.blockers.length
    const nextG =
      parent.g +
      edge.cost +
      (this.historyCostByEdge.get(edge.key) ?? 0) +
      foreignOwners.length * this.preparedProblem.options.crossingCost +
      newlyAddedBlockers * this.preparedProblem.options.ripCost
    const key = stateKey(edge.toNode, nextBlockers)
    if (
      nextG >= (search.bestCostByState.get(key) ?? Number.POSITIVE_INFINITY)
    ) {
      return
    }

    const nextSearchNodeIndex = search.nodes.length
    search.nodes.push({
      graphNode: edge.toNode,
      g: nextG,
      parentIndex,
      blockers: nextBlockers,
      edgeFromParent: edge,
    })
    search.bestCostByState.set(key, nextG)
    search.open.push(
      nextG + search.heuristic[edge.toNode]!,
      nextSearchNodeIndex,
    )
  }

  private getForeignOwners(edge: VectorGraphEdge, netId: string) {
    const owners = new Set<string>()
    for (const graphNodeIndex of [edge.fromNode, edge.toNode]) {
      const graphNode = this.preparedProblem.nodes[graphNodeIndex]!
      if (graphNode.kind !== "via_port" || !graphNode.portId) continue
      for (const routeId of this.viaOwners.get(graphNode.portId) ?? []) {
        const demand = this.preparedProblem.demandById.get(routeId)
        if (!demand) {
          throw new Error(`Via occupancy references unknown route "${routeId}"`)
        }
        if (demand.netId !== netId) owners.add(routeId)
      }
    }

    if (edge.kind === "trace") {
      const from = this.preparedProblem.nodes[edge.fromNode]!
      const to = this.preparedProblem.nodes[edge.toNode]!
      for (const route of this.committed.values()) {
        if (route.netId === netId) continue
        if (
          route.segments.some(
            (segment) =>
              segment.kind === "trace" &&
              segmentsIntersect(from, to, segment.from, segment.to),
          )
        ) {
          owners.add(route.routeId)
        }
      }
    }
    return [...owners].sort()
  }

  private pathContainsGraphNode(
    nodes: SearchNode[],
    searchNodeIndex: number,
    graphNode: number,
  ) {
    for (
      let cursor = searchNodeIndex;
      cursor >= 0;
      cursor = nodes[cursor]!.parentIndex
    ) {
      if (nodes[cursor]!.graphNode === graphNode) return true
    }
    return false
  }

  private edgeIntersectsEarlierPath(
    nodes: SearchNode[],
    parentIndex: number,
    edge: VectorGraphEdge,
  ) {
    const candidateFrom = this.preparedProblem.nodes[edge.fromNode]!
    const candidateTo = this.preparedProblem.nodes[edge.toNode]!
    let childIndex = parentIndex
    let isImmediatelyPreviousEdge = true
    while (childIndex >= 0) {
      const child = nodes[childIndex]!
      const priorEdge = child.edgeFromParent
      if (priorEdge?.kind === "trace") {
        const priorFrom = this.preparedProblem.nodes[priorEdge.fromNode]!
        const priorTo = this.preparedProblem.nodes[priorEdge.toNode]!
        const segmentsAreCollinear =
          Math.abs(
            (candidateTo.x - candidateFrom.x) * (priorTo.y - priorFrom.y) -
              (candidateTo.y - candidateFrom.y) * (priorTo.x - priorFrom.x),
          ) <= 1e-7
        if (
          segmentsIntersect(candidateFrom, candidateTo, priorFrom, priorTo) &&
          (!isImmediatelyPreviousEdge || segmentsAreCollinear)
        ) {
          return true
        }
      }
      isImmediatelyPreviousEdge = false
      childIndex = child.parentIndex
    }
    return false
  }

  private computeUncongestedDistanceTo(targetNode: number) {
    const distance = new Float64Array(this.preparedProblem.nodes.length)
    distance.fill(Number.POSITIVE_INFINITY)
    distance[targetNode] = 0
    const open = new MinHeap<number>()
    open.push(0, targetNode)

    while (open.size > 0) {
      const graphNode = open.pop()!
      const currentDistance = distance[graphNode]!
      for (const edge of this.preparedProblem.adjacency[graphNode]!) {
        const candidateDistance = currentDistance + edge.cost
        if (candidateDistance + 1e-9 >= distance[edge.toNode]!) continue
        distance[edge.toNode] = candidateDistance
        open.push(candidateDistance, edge.toNode)
      }
    }
    return distance
  }

  private commitGoal(search: ActiveSearch, goalSearchNodeIndex: number) {
    const goalNode = search.nodes[goalSearchNodeIndex]!
    if (
      this.totalRipCount + goalNode.blockers.length >
      this.preparedProblem.options.maxTotalRips
    ) {
      this.failActiveSearch(
        `Total rip limit (${this.preparedProblem.options.maxTotalRips}) reached`,
      )
      return
    }
    for (const blockerRouteId of goalNode.blockers) {
      this.ripRoute(blockerRouteId)
    }

    const searchNodePath: SearchNode[] = []
    for (
      let cursor = goalSearchNodeIndex;
      cursor >= 0;
      cursor = search.nodes[cursor]!.parentIndex
    ) {
      searchNodePath.push(search.nodes[cursor]!)
    }
    searchNodePath.reverse()

    const points = searchNodePath.map(({ graphNode }) => {
      const node = this.preparedProblem.nodes[graphNode]!
      return { nodeId: node.nodeId, kind: node.kind, x: node.x, y: node.y }
    })
    const segments: RoutedSegment[] = []
    for (let index = 1; index < searchNodePath.length; index++) {
      const edge = searchNodePath[index]!.edgeFromParent
      if (!edge) throw new Error("Solved vector path is missing an edge")
      const from = points[index - 1]!
      const to = points[index]!
      segments.push(
        edge.kind === "trace"
          ? { kind: "trace", edgeKey: edge.key, from, to }
          : {
              kind: "via_jump",
              edgeKey: edge.key,
              from,
              to,
              entryPortId: edge.entryPortId,
              exitPortId: edge.exitPortId,
            },
      )
    }

    const usedViaPortIds = [
      ...new Set(
        searchNodePath.flatMap(({ graphNode }) => {
          const node = this.preparedProblem.nodes[graphNode]!
          return node.kind === "via_port" && node.portId ? [node.portId] : []
        }),
      ),
    ]
    const route: RoutedConnection = {
      routeId: search.demand.routeId,
      netId: search.demand.netId,
      sourcePortId: search.demand.sourcePortId,
      targetPortId: search.demand.targetPortId,
      points,
      segments,
      usedViaPortIds,
    }
    this.committed.set(route.routeId, route)
    for (const viaPortId of route.usedViaPortIds) {
      const owners = this.viaOwners.get(viaPortId) ?? new Set<string>()
      owners.add(route.routeId)
      this.viaOwners.set(viaPortId, owners)
    }
    this.activeSearch = null
  }

  private ripRoute(routeId: string) {
    const route = this.committed.get(routeId)
    if (!route) throw new Error(`Cannot rip uncommitted route "${routeId}"`)

    for (const segment of route.segments) {
      this.historyCostByEdge.set(
        segment.edgeKey,
        (this.historyCostByEdge.get(segment.edgeKey) ?? 0) +
          this.preparedProblem.options.historyIncrement,
      )
    }
    for (const viaPortId of route.usedViaPortIds) {
      const owners = this.viaOwners.get(viaPortId)
      owners?.delete(routeId)
      if (owners?.size === 0) this.viaOwners.delete(viaPortId)
    }
    this.committed.delete(routeId)
    this.ripCountByRoute.set(
      routeId,
      (this.ripCountByRoute.get(routeId) ?? 0) + 1,
    )
    this.totalRipCount++
    const demand = this.preparedProblem.demandById.get(routeId)
    if (!demand) throw new Error(`Cannot requeue unknown route "${routeId}"`)
    if (!this.pending.some((candidate) => candidate.routeId === routeId)) {
      this.pending.push(demand)
    }
  }

  private failActiveSearch(message: string) {
    this.error = message
    this.failed = true
    this.activeSearch = null
  }

  private validateFinalGeometry() {
    if (this.committed.size !== this.preparedProblem.demands.length) {
      throw new Error(
        `Expected ${this.preparedProblem.demands.length} committed routes, got ${this.committed.size}`,
      )
    }
    const routes = [...this.committed.values()]
    for (let firstIndex = 0; firstIndex < routes.length; firstIndex++) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < routes.length;
        secondIndex++
      ) {
        const first = routes[firstIndex]!
        const second = routes[secondIndex]!
        if (first.netId === second.netId) continue
        for (const firstSegment of first.segments) {
          if (firstSegment.kind !== "trace") continue
          for (const secondSegment of second.segments) {
            if (
              secondSegment.kind === "trace" &&
              segmentsIntersect(
                firstSegment.from,
                firstSegment.to,
                secondSegment.from,
                secondSegment.to,
              )
            ) {
              throw new Error(
                `Final vector routes "${first.routeId}" and "${second.routeId}" intersect`,
              )
            }
          }
        }
      }
    }

    for (const [viaPortId, ownerRouteIds] of this.viaOwners) {
      const netIds = new Set(
        [...ownerRouteIds].map(
          (routeId) => this.preparedProblem.demandById.get(routeId)!.netId,
        ),
      )
      if (netIds.size > 1) {
        throw new Error(
          `Final routes from different nets share via port "${viaPortId}"`,
        )
      }
    }
  }

  private getSolutionStats(): BoundaryRoutingStats {
    let viaJumpCount = 0
    for (const route of this.committed.values()) {
      viaJumpCount += route.segments.filter(
        (segment) => segment.kind === "via_jump",
      ).length
    }
    let maxHistoryCost = 0
    for (const cost of this.historyCostByEdge.values()) {
      maxHistoryCost = Math.max(maxHistoryCost, cost)
    }
    return {
      routeCount: this.preparedProblem.demands.length,
      routedCount: this.committed.size,
      pendingCount: this.pending.length + (this.activeSearch ? 1 : 0),
      ripCount: this.totalRipCount,
      expandedStateCount: this.totalExpandedStateCount,
      viaJumpCount,
      maxHistoryCost,
    }
  }

  private updateStats() {
    this.stats = {
      ...this.getSolutionStats(),
      activeRouteId: this.activeSearch?.demand.routeId ?? null,
      activeExpandedStateCount: this.activeSearch?.expanded ?? 0,
    }
  }

  override getOutput(): BoundaryRoutingSolution {
    const routes = this.preparedProblem.demands.flatMap((demand) => {
      const route = this.committed.get(demand.routeId)
      return route ? [route] : []
    })
    return { routes, stats: this.getSolutionStats() }
  }

  override visualize(): GraphicsObject {
    const initial = visualizeProblem(this.preparedProblem.problem)
    const lines = [...(initial.lines ?? [])]
    const points = [...(initial.points ?? [])]

    for (const route of this.committed.values()) {
      const color = netColor(route.netId)
      for (const segment of route.segments) {
        if (segment.kind === "trace") {
          lines.push({
            points: [segment.from, segment.to],
            strokeColor: color,
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
            label: `${segment.entryPortId} ↔ ${segment.exitPortId}`,
          })
        }
      }
    }

    if (this.activeSearch) {
      for (const graphNode of new Set(
        this.activeSearch.nodes.slice(-1000).map((node) => node.graphNode),
      )) {
        points.push({
          ...this.preparedProblem.nodes[graphNode]!,
          color: "rgba(100,116,139,0.28)",
          label: "A* explored",
        })
      }
    }

    return {
      ...initial,
      title: `Vector rip-up A* (${this.committed.size}/${this.preparedProblem.demands.length} routes, ${this.totalRipCount} rips)`,
      lines,
      points,
    }
  }

  override preview() {
    return this.visualize()
  }
}

interface RoutingAttempt {
  name: string
  preparedProblem: PreparedBoundaryRoutingProblem
}

const demandsAreEqual = (
  left: readonly RouteDemand[],
  right: readonly RouteDemand[],
) =>
  left.length === right.length &&
  left.every(
    (demand, index) =>
      demand.routeId === right[index]?.routeId &&
      demand.sourceNode === right[index]?.sourceNode &&
      demand.targetNode === right[index]?.targetNode,
  )

const orderDemandsShortestFirst = (
  preparedProblem: PreparedBoundaryRoutingProblem,
  demands: readonly RouteDemand[],
) =>
  [...demands].sort((left, right) => {
    const leftSource = preparedProblem.nodes[left.sourceNode]!
    const leftTarget = preparedProblem.nodes[left.targetNode]!
    const rightSource = preparedProblem.nodes[right.sourceNode]!
    const rightTarget = preparedProblem.nodes[right.targetNode]!
    const leftDistance = Math.hypot(
      leftSource.x - leftTarget.x,
      leftSource.y - leftTarget.y,
    )
    const rightDistance = Math.hypot(
      rightSource.x - rightTarget.x,
      rightSource.y - rightTarget.y,
    )
    return (
      leftDistance - rightDistance || left.routeId.localeCompare(right.routeId)
    )
  })

const createAttempt = (
  name: string,
  preparedProblem: PreparedBoundaryRoutingProblem,
  demands: RouteDemand[],
): RoutingAttempt => ({
  name,
  preparedProblem: {
    ...preparedProblem,
    demands,
    demandById: new Map(demands.map((demand) => [demand.routeId, demand])),
  },
})

const createRoutingAttempts = (
  preparedProblem: PreparedBoundaryRoutingProblem,
): RoutingAttempt[] => {
  const attempts: RoutingAttempt[] = [{ name: "nearest-tree", preparedProblem }]
  const shortestFirstDemands = orderDemandsShortestFirst(
    preparedProblem,
    preparedProblem.demands,
  )
  if (!demandsAreEqual(preparedProblem.demands, shortestFirstDemands)) {
    attempts.push(
      createAttempt(
        "nearest-tree-shortest-first",
        preparedProblem,
        shortestFirstDemands,
      ),
    )
  }
  const rootStarDemands = buildNetDemands(
    preparedProblem.problem.breakoutBoundary.ports,
    preparedProblem.breakoutPortNodeById,
    "root_star",
  )
  if (!demandsAreEqual(preparedProblem.demands, rootStarDemands)) {
    attempts.push(createAttempt("root-star", preparedProblem, rootStarDemands))
  }
  return attempts
}

export class RipUpAStarBoundarySolver extends BaseSolver {
  private readonly attempts: RoutingAttempt[]
  private readonly failedAttemptErrors: string[] = []
  private readonly completedAttemptStats: BoundaryRoutingStats[] = []
  private attemptIndex = 0
  private attemptSolver: SingleAttemptRipUpAStarBoundarySolver

  constructor(
    private readonly preparedProblem: PreparedBoundaryRoutingProblem,
  ) {
    super()
    this.attempts = createRoutingAttempts(preparedProblem)
    this.attemptSolver = this.createAttemptSolver()
    this.MAX_ITERATIONS = Math.max(
      100_000,
      this.attemptSolver.MAX_ITERATIONS * this.attempts.length + 100,
    )
    this.updateAttemptStats()
  }

  override getSolverName() {
    return "RipUpAStarBoundarySolver"
  }

  override getConstructorParams(): [PreparedBoundaryRoutingProblem] {
    return [this.preparedProblem]
  }

  get activeDemand() {
    return this.attemptSolver.activeDemand
  }

  get committedRoutes() {
    return this.attemptSolver.committedRoutes
  }

  get pendingRouteIds() {
    return this.attemptSolver.pendingRouteIds
  }

  override _step() {
    try {
      this.attemptSolver.step()
    } catch (error) {
      if (!this.attemptSolver.failed) throw error
    }

    if (this.attemptSolver.solved) {
      this.solved = true
      this.progress = 1
      this.updateAttemptStats()
      return
    }

    if (this.attemptSolver.failed) {
      this.failedAttemptErrors.push(
        `${this.attempts[this.attemptIndex]!.name}: ${
          this.attemptSolver.error || "routing failed"
        }`,
      )
      if (this.attemptIndex + 1 < this.attempts.length) {
        this.completedAttemptStats.push(this.attemptSolver.getOutput().stats)
        this.attemptIndex++
        this.attemptSolver = this.createAttemptSolver()
        this.progress = 0
        this.updateAttemptStats()
        return
      }
      this.error = this.failedAttemptErrors.join("; ")
      this.failed = true
      this.updateAttemptStats()
      return
    }

    this.progress =
      (this.attemptIndex + this.attemptSolver.progress) / this.attempts.length
    this.updateAttemptStats()
  }

  private createAttemptSolver() {
    const solver = new SingleAttemptRipUpAStarBoundarySolver(
      this.attempts[this.attemptIndex]!.preparedProblem,
    )
    this.activeSubSolver = solver
    return solver
  }

  private updateAttemptStats() {
    this.stats = {
      ...this.getAggregatedStats(),
      attempt: this.attemptIndex + 1,
      attemptCount: this.attempts.length,
      attemptStrategy: this.attempts[this.attemptIndex]!.name,
      failedAttemptErrors: [...this.failedAttemptErrors],
    }
  }

  private getAggregatedStats(): BoundaryRoutingStats {
    const currentStats = this.attemptSolver.getOutput().stats
    return {
      ...currentStats,
      ripCount:
        currentStats.ripCount +
        this.completedAttemptStats.reduce(
          (total, attemptStats) => total + attemptStats.ripCount,
          0,
        ),
      expandedStateCount:
        currentStats.expandedStateCount +
        this.completedAttemptStats.reduce(
          (total, attemptStats) => total + attemptStats.expandedStateCount,
          0,
        ),
      maxHistoryCost: Math.max(
        currentStats.maxHistoryCost,
        ...this.completedAttemptStats.map(
          (attemptStats) => attemptStats.maxHistoryCost,
        ),
      ),
    }
  }

  override getOutput(): BoundaryRoutingSolution {
    const solution = this.attemptSolver.getOutput()
    return { ...solution, stats: this.getAggregatedStats() }
  }

  override visualize(): GraphicsObject {
    const visualization = this.attemptSolver.visualize()
    return {
      ...visualization,
      title: `${visualization.title ?? "Vector rip-up A*"} · attempt ${
        this.attemptIndex + 1
      }/${this.attempts.length} (${this.attempts[this.attemptIndex]!.name})`,
    }
  }

  override preview() {
    return this.visualize()
  }
}
