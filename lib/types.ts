export interface Point {
  x: number
  y: number
}

export interface RectBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface BreakoutPort extends Point {
  portId: string
  netId: string
}

export interface ViaPort extends Point {
  portId: string
  pairedPortId: string
}

export interface BreakoutBoundary extends RectBounds {
  ports: BreakoutPort[]
}

export interface ViaBoundary extends RectBounds {
  ports: ViaPort[]
}

export interface BoundaryRoutingOptions {
  viaJumpCost?: number
  ripCost?: number
  crossingCost?: number
  historyIncrement?: number
  maxBlockersPerSearch?: number
  maxRipsPerRoute?: number
  maxTotalRips?: number
  maxSearchStates?: number
  expansionsPerStep?: number
}

export interface BoundaryRoutingProblem {
  breakoutBoundary: BreakoutBoundary
  viaBoundary: ViaBoundary
  options?: BoundaryRoutingOptions
}

export interface NormalizedBoundaryRoutingOptions {
  viaJumpCost: number
  ripCost: number
  crossingCost: number
  historyIncrement: number
  maxBlockersPerSearch: number
  maxRipsPerRoute: number
  maxTotalRips: number
  maxSearchStates: number
  expansionsPerStep: number
}

export type VectorGraphNodeKind = "breakout_port" | "via_port" | "routing_point"

export interface VectorGraphNode extends Point {
  nodeId: string
  kind: VectorGraphNodeKind
  portId?: string
  netId?: string
}

export type VectorGraphEdge =
  | {
      key: string
      kind: "trace"
      fromNode: number
      toNode: number
      cost: number
    }
  | {
      key: string
      kind: "via_jump"
      fromNode: number
      toNode: number
      cost: number
      entryPortId: string
      exitPortId: string
    }

export interface RouteDemand {
  routeId: string
  netId: string
  sourcePortId: string
  targetPortId: string
  sourceNode: number
  targetNode: number
}

export interface PreparedBoundaryRoutingProblem {
  problem: BoundaryRoutingProblem
  options: NormalizedBoundaryRoutingOptions
  nodes: VectorGraphNode[]
  adjacency: VectorGraphEdge[][]
  demands: RouteDemand[]
  demandById: Map<string, RouteDemand>
  breakoutPortNodeById: Map<string, number>
  viaPortNodeById: Map<string, number>
}

export interface RoutePoint extends Point {
  nodeId: string
  kind: VectorGraphNodeKind
}

export type RoutedSegment =
  | {
      kind: "trace"
      edgeKey: string
      from: RoutePoint
      to: RoutePoint
    }
  | {
      kind: "via_jump"
      edgeKey: string
      from: RoutePoint
      to: RoutePoint
      entryPortId: string
      exitPortId: string
    }

export interface RoutedConnection {
  routeId: string
  netId: string
  sourcePortId: string
  targetPortId: string
  points: RoutePoint[]
  segments: RoutedSegment[]
  usedViaPortIds: string[]
}

export interface BoundaryRoutingStats {
  routeCount: number
  routedCount: number
  pendingCount: number
  ripCount: number
  expandedStateCount: number
  viaJumpCount: number
  maxHistoryCost: number
}

export interface BoundaryRoutingSolution {
  routes: RoutedConnection[]
  stats: BoundaryRoutingStats
}
