import {
  type HighDensityIntraNodeRoute,
  type HighDensityObstacle,
  type HighDensityRectObstacle,
  HighDensitySolverB01,
} from "@tscircuit/high-density-b01"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  netColor,
  pointDistance,
  pointsEqual,
  visualizeProblem,
} from "./geometry"
import { RipUpAStarBoundarySolver } from "./rip-up-a-star-boundary-solver"
import type {
  AssignedBoundaryRoutingProblem,
  BoundaryRoutingSolution,
  BoundaryRoutingStats,
  Point,
  RectBounds,
  RoutedConnection,
  RoutedSegment,
  RoutePoint,
} from "./types"
import { getDifferentNetGeometryViolationError } from "./validate-boundary-routing-solution"

const TRACE_THICKNESS = 0.1
const TRACE_MARGIN = 0.15
const VIA_DIAMETER = 0.3
const HIGH_RESOLUTION_CELL_SIZE = 0.1
const MIN_WINDOW_SIZE = 0.5

interface PhysicalRoutingTask {
  taskId: string
  connectionId: string
  segmentIndex: number
  netId: string
  fromPortId: string
  toPortId: string
  fromKind: RoutePoint["kind"]
  toKind: RoutePoint["kind"]
  from: Point
  to: Point
  logicalRouteId?: string
}

interface PhysicalRoute {
  task: PhysicalRoutingTask
  points: RoutePoint[]
  highDensityRoute: HighDensityIntraNodeRoute
}

interface PhysicalRoutingBatch {
  batchId: string
  tasks: PhysicalRoutingTask[]
  window: RectBounds
}

const getPortPoint = (
  assignedProblem: AssignedBoundaryRoutingProblem,
  portId: string,
) => {
  const breakoutPort =
    assignedProblem.preparedProblem.problem.breakoutBoundary.ports.find(
      (port) => port.portId === portId,
    )
  if (breakoutPort) return breakoutPort
  const viaPort =
    assignedProblem.preparedProblem.problem.viaBoundary.ports.find(
      (port) => port.portId === portId,
    )
  if (viaPort) return viaPort
  throw new Error(`Unknown physical routing port "${portId}"`)
}

const pushDistinct = (points: Point[], point: Point) => {
  if (!points.at(-1) || !pointsEqual(points.at(-1)!, point)) {
    points.push(point)
  }
}

const subdividePolyline = (points: Point[], maximumSegmentLength = 8) => {
  const result: Point[] = []
  for (let index = 0; index < points.length - 1; index++) {
    const from = points[index]!
    const to = points[index + 1]!
    pushDistinct(result, from)
    const segmentCount = Math.max(
      1,
      Math.ceil(pointDistance(from, to) / maximumSegmentLength),
    )
    for (let step = 1; step <= segmentCount; step++) {
      pushDistinct(result, {
        x: from.x + ((to.x - from.x) * step) / segmentCount,
        y: from.y + ((to.y - from.y) * step) / segmentCount,
      })
    }
  }
  return result
}

const projectToViaBoundary = (
  point: Point,
  breakoutBoundary: RectBounds,
  viaBoundary: RectBounds,
) => {
  if (Math.abs(point.y - breakoutBoundary.maxY) <= 1e-7) {
    return { x: point.x, y: viaBoundary.maxY }
  }
  if (Math.abs(point.x - breakoutBoundary.maxX) <= 1e-7) {
    return { x: viaBoundary.maxX, y: point.y }
  }
  if (Math.abs(point.y - breakoutBoundary.minY) <= 1e-7) {
    return { x: point.x, y: viaBoundary.minY }
  }
  return { x: viaBoundary.minX, y: point.y }
}

const outerBoundaryStation = (point: Point, bounds: RectBounds) => {
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  if (Math.abs(point.y - bounds.maxY) <= 1e-7) {
    return point.x - bounds.minX
  }
  if (Math.abs(point.x - bounds.maxX) <= 1e-7) {
    return width + (bounds.maxY - point.y)
  }
  if (Math.abs(point.y - bounds.minY) <= 1e-7) {
    return width + height + (bounds.maxX - point.x)
  }
  return width * 2 + height + (point.y - bounds.minY)
}

const pointAtOuterBoundaryStation = (
  station: number,
  bounds: RectBounds,
): Point => {
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const perimeter = 2 * (width + height)
  const normalized = ((station % perimeter) + perimeter) % perimeter
  if (normalized <= width) {
    return { x: bounds.minX + normalized, y: bounds.maxY }
  }
  if (normalized <= width + height) {
    return {
      x: bounds.maxX,
      y: bounds.maxY - (normalized - width),
    }
  }
  if (normalized <= width * 2 + height) {
    return {
      x: bounds.maxX - (normalized - width - height),
      y: bounds.minY,
    }
  }
  return {
    x: bounds.minX,
    y: bounds.minY + (normalized - width * 2 - height),
  }
}

const getBreakoutToViaPath = (
  breakoutPoint: Point,
  viaPoint: Point,
  breakoutBoundary: RectBounds,
  viaBoundary: RectBounds,
  requestedLaneInset: number,
) => {
  const outerProjection = projectToViaBoundary(
    breakoutPoint,
    breakoutBoundary,
    viaBoundary,
  )
  const insetOuterPoint = (point: Point): Point => {
    let x = point.x
    let y = point.y
    if (Math.abs(point.y - viaBoundary.maxY) <= 1e-7) {
      y -= Math.min(
        requestedLaneInset,
        (viaBoundary.maxY - breakoutBoundary.maxY) * 0.8,
      )
    }
    if (Math.abs(point.x - viaBoundary.maxX) <= 1e-7) {
      x -= Math.min(
        requestedLaneInset,
        (viaBoundary.maxX - breakoutBoundary.maxX) * 0.8,
      )
    }
    if (Math.abs(point.y - viaBoundary.minY) <= 1e-7) {
      y += Math.min(
        requestedLaneInset,
        (breakoutBoundary.minY - viaBoundary.minY) * 0.8,
      )
    }
    if (Math.abs(point.x - viaBoundary.minX) <= 1e-7) {
      x += Math.min(
        requestedLaneInset,
        (breakoutBoundary.minX - viaBoundary.minX) * 0.8,
      )
    }
    return { x, y }
  }
  const projectionStation = outerBoundaryStation(outerProjection, viaBoundary)
  const viaStation = outerBoundaryStation(viaPoint, viaBoundary)
  const perimeter =
    2 *
    (viaBoundary.maxX - viaBoundary.minX + viaBoundary.maxY - viaBoundary.minY)
  let delta = viaStation - projectionStation
  if (delta > perimeter / 2) delta -= perimeter
  if (delta < -perimeter / 2) delta += perimeter
  const boundaryStepCount = Math.max(1, Math.ceil(Math.abs(delta) / 8))
  const path = [breakoutPoint, insetOuterPoint(outerProjection)]
  for (let step = 1; step <= boundaryStepCount; step++) {
    pushDistinct(
      path,
      insetOuterPoint(
        pointAtOuterBoundaryStation(
          projectionStation + (delta * step) / boundaryStepCount,
          viaBoundary,
        ),
      ),
    )
  }
  pushDistinct(path, viaPoint)
  return subdividePolyline(path)
}

const appendConnectionTasks = ({
  tasks,
  connectionId,
  netId,
  points,
  fromPortId,
  toPortId,
  fromKind,
  toKind,
  logicalRouteId,
}: {
  tasks: PhysicalRoutingTask[]
  connectionId: string
  netId: string
  points: Point[]
  fromPortId: string
  toPortId: string
  fromKind: PhysicalRoutingTask["fromKind"]
  toKind: PhysicalRoutingTask["toKind"]
  logicalRouteId?: string
}) => {
  for (let index = 0; index < points.length - 1; index++) {
    const isFirst = index === 0
    const isLast = index === points.length - 2
    tasks.push({
      taskId: `${connectionId}:segment:${index}`,
      connectionId,
      segmentIndex: index,
      logicalRouteId,
      netId,
      fromPortId: isFirst ? fromPortId : `${connectionId}:waypoint:${index}`,
      toPortId: isLast ? toPortId : `${connectionId}:waypoint:${index + 1}`,
      fromKind: isFirst ? fromKind : "routing_point",
      toKind: isLast ? toKind : "routing_point",
      from: points[index]!,
      to: points[index + 1]!,
    })
  }
}

const buildPhysicalTasks = (
  assignedProblem: AssignedBoundaryRoutingProblem,
) => {
  const { preparedProblem } = assignedProblem
  const tasks: PhysicalRoutingTask[] = []
  const routedLegIds = new Set<string>()
  const routedNetIds = [
    ...new Set(preparedProblem.demands.map((demand) => demand.netId)),
  ].sort()
  const laneIndexByNetId = new Map(
    routedNetIds.map((netId, index) => [netId, index + 1]),
  )

  for (const demand of preparedProblem.demands) {
    const assignment = assignedProblem.demandAssignmentByRouteId.get(
      demand.routeId,
    )!
    if (!assignment.viaPair) {
      const connectionId = `direct:${demand.routeId}`
      appendConnectionTasks({
        tasks,
        connectionId,
        logicalRouteId: demand.routeId,
        netId: demand.netId,
        fromPortId: demand.sourcePortId,
        toPortId: demand.targetPortId,
        fromKind: "breakout_port",
        toKind: "breakout_port",
        points: subdividePolyline([
          getPortPoint(assignedProblem, demand.sourcePortId),
          getPortPoint(assignedProblem, demand.targetPortId),
        ]),
      })
      continue
    }

    for (const breakoutPortId of [demand.sourcePortId, demand.targetPortId]) {
      const viaPortId =
        breakoutPortId === demand.sourcePortId
          ? assignment.sourceViaPortId!
          : assignment.targetViaPortId!
      const taskId = `leg:${breakoutPortId}->${viaPortId}`
      if (routedLegIds.has(taskId)) continue
      routedLegIds.add(taskId)
      const breakoutPoint = getPortPoint(assignedProblem, breakoutPortId)
      const viaPoint = getPortPoint(assignedProblem, viaPortId)
      appendConnectionTasks({
        tasks,
        connectionId: taskId,
        netId: demand.netId,
        fromPortId: breakoutPortId,
        toPortId: viaPortId,
        fromKind: "breakout_port",
        toKind: "via_port",
        points: getBreakoutToViaPath(
          breakoutPoint,
          viaPoint,
          preparedProblem.problem.breakoutBoundary,
          preparedProblem.problem.viaBoundary,
          (laneIndexByNetId.get(demand.netId) ?? 1) * 0.35,
        ),
      })
    }
  }

  return tasks
}

const expandSmallWindow = (
  min: number,
  max: number,
  boundaryMin: number,
  boundaryMax: number,
) => {
  if (max - min >= MIN_WINDOW_SIZE) return { min, max }
  const center = (min + max) / 2
  let expandedMin = Math.max(boundaryMin, center - MIN_WINDOW_SIZE / 2)
  let expandedMax = Math.min(boundaryMax, center + MIN_WINDOW_SIZE / 2)
  if (expandedMax - expandedMin < MIN_WINDOW_SIZE) {
    if (expandedMin === boundaryMin) {
      expandedMax = Math.min(boundaryMax, boundaryMin + MIN_WINDOW_SIZE)
    } else {
      expandedMin = Math.max(boundaryMin, boundaryMax - MIN_WINDOW_SIZE)
    }
  }
  return { min: expandedMin, max: expandedMax }
}

export const getHighDensityRoutingWindow = (
  first: Point,
  second: Point,
  viaBoundary: RectBounds,
  margin: number,
): RectBounds => {
  const x = expandSmallWindow(
    Math.max(viaBoundary.minX, Math.min(first.x, second.x) - margin),
    Math.min(viaBoundary.maxX, Math.max(first.x, second.x) + margin),
    viaBoundary.minX,
    viaBoundary.maxX,
  )
  const y = expandSmallWindow(
    Math.max(viaBoundary.minY, Math.min(first.y, second.y) - margin),
    Math.min(viaBoundary.maxY, Math.max(first.y, second.y) + margin),
    viaBoundary.minY,
    viaBoundary.maxY,
  )
  return { minX: x.min, maxX: x.max, minY: y.min, maxY: y.max }
}

const boundsIntersect = (first: RectBounds, second: RectBounds) =>
  first.minX <= second.maxX &&
  first.maxX >= second.minX &&
  first.minY <= second.maxY &&
  first.maxY >= second.minY

const MAX_HIGH_DENSITY_WINDOW_SIZE = 15

const fitAxisToHighDensityWindow = (
  pointMin: number,
  pointMax: number,
  boundaryMin: number,
  boundaryMax: number,
  margin: number,
) => {
  const pointSpan = pointMax - pointMin
  if (pointSpan > MAX_HIGH_DENSITY_WINDOW_SIZE + 1e-7) return null
  const size = Math.min(
    boundaryMax - boundaryMin,
    MAX_HIGH_DENSITY_WINDOW_SIZE,
    Math.max(MIN_WINDOW_SIZE, pointSpan + margin * 2),
  )
  let min = Math.max(
    boundaryMin,
    Math.min(pointMin - margin, boundaryMax - size),
  )
  let max = min + size
  if (max < pointMax) {
    max = pointMax
    min = max - size
  }
  return { min, max }
}

const getSharedHighDensityRoutingWindow = (
  tasks: PhysicalRoutingTask[],
  viaBoundary: RectBounds,
  margin: number,
): RectBounds | null => {
  const points = tasks.flatMap((task) => [task.from, task.to])
  const x = fitAxisToHighDensityWindow(
    Math.min(...points.map((point) => point.x)),
    Math.max(...points.map((point) => point.x)),
    viaBoundary.minX,
    viaBoundary.maxX,
    margin,
  )
  const y = fitAxisToHighDensityWindow(
    Math.min(...points.map((point) => point.y)),
    Math.max(...points.map((point) => point.y)),
    viaBoundary.minY,
    viaBoundary.maxY,
    margin,
  )
  if (!x || !y) return null
  return { minX: x.min, maxX: x.max, minY: y.min, maxY: y.max }
}

const buildPhysicalBatches = (
  tasks: PhysicalRoutingTask[],
  viaBoundary: RectBounds,
  margin: number,
) => {
  const batches: PhysicalRoutingBatch[] = []
  const orderedTasks = [...tasks]

  for (const task of orderedTasks) {
    const taskWindow = getHighDensityRoutingWindow(
      task.from,
      task.to,
      viaBoundary,
      margin,
    )
    batches.push({
      batchId: `physical-batch:${batches.length}`,
      tasks: [task],
      window: taskWindow,
    })
  }
  return batches
}

const approximateRouteWithRects = (
  route: HighDensityIntraNodeRoute,
  window: RectBounds,
): HighDensityRectObstacle[] => {
  // Rect obstacles do not receive B01's route-to-route traceMargin, so include
  // it in the rectangle dimensions to preserve the same copper keepout.
  const obstacles: HighDensityRectObstacle[] = []
  const addRect = (
    obstacle: Omit<
      HighDensityRectObstacle,
      "type" | "connectionName" | "rootConnectionName"
    >,
    suffix: string,
  ) => {
    const angle = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
    const halfWidth =
      (Math.abs(Math.cos(angle)) * obstacle.width +
        Math.abs(Math.sin(angle)) * obstacle.height) /
      2
    const halfHeight =
      (Math.abs(Math.sin(angle)) * obstacle.width +
        Math.abs(Math.cos(angle)) * obstacle.height) /
      2
    const bounds = {
      minX: obstacle.center.x - halfWidth,
      maxX: obstacle.center.x + halfWidth,
      minY: obstacle.center.y - halfHeight,
      maxY: obstacle.center.y + halfHeight,
    }
    if (!boundsIntersect(bounds, window)) return
    obstacles.push({
      type: "rect",
      connectionName: `${route.connectionName}:approx:${suffix}`,
      rootConnectionName:
        route.rootConnectionName ??
        route.connectionName.replace(/_mst\d+$/, ""),
      ...obstacle,
    })
  }

  for (let index = 1; index < route.route.length; index++) {
    const from = route.route[index - 1]!
    const to = route.route[index]!
    if (from.z !== to.z) {
      addRect(
        {
          center: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
          width: route.viaDiameter + TRACE_MARGIN * 2,
          height: route.viaDiameter + TRACE_MARGIN * 2,
          zLayers: [0, 1],
        },
        `transition:${index}`,
      )
      continue
    }
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy)
    if (length <= 1e-9) continue
    addRect(
      {
        center: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
        width: length + TRACE_MARGIN * 2,
        height: route.traceThickness + TRACE_MARGIN * 2,
        ccwRotationDegrees: (Math.atan2(dy, dx) * 180) / Math.PI,
        zLayers: [from.z],
      },
      `segment:${index}`,
    )
  }

  for (const [index, via] of route.vias.entries()) {
    addRect(
      {
        center: via,
        width: route.viaDiameter + TRACE_MARGIN * 2,
        height: route.viaDiameter + TRACE_MARGIN * 2,
        zLayers: [0, 1],
      },
      `via:${index}`,
    )
  }
  return obstacles
}

const createBreakoutObstacle = (bounds: RectBounds): HighDensityObstacle => {
  // Boundary ports are legal trace endpoints. Insetting by one fine-grid cell
  // keeps the strict interior blocked without rasterizing the endpoint itself.
  const inset = HIGH_RESOLUTION_CELL_SIZE
  return {
    type: "rect",
    connectionName: "__breakout_interior__",
    rootConnectionName: "__breakout_interior__",
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    width: Math.max(0, bounds.maxX - bounds.minX - inset * 2),
    height: Math.max(0, bounds.maxY - bounds.minY - inset * 2),
    zLayers: [0, 1],
  }
}

const orientHighDensityRoute = (
  task: PhysicalRoutingTask,
  route: HighDensityIntraNodeRoute,
) => {
  const first = route.route[0]
  const last = route.route.at(-1)
  if (!first || !last) {
    throw new Error(
      `high-density-b01 returned an empty route for "${task.taskId}"`,
    )
  }
  if (pointDistance(first, task.from) <= pointDistance(last, task.from)) {
    return route.route
  }
  return [...route.route].reverse()
}

const toPhysicalRoute = (
  task: PhysicalRoutingTask,
  route: HighDensityIntraNodeRoute,
): PhysicalRoute => {
  const routePoints = orientHighDensityRoute(task, route)
  const points = routePoints.map(
    (point, index): RoutePoint => ({
      x: point.x,
      y: point.y,
      z: point.z,
      nodeId:
        index === 0
          ? `${task.fromKind === "via_port" ? "via" : "breakout"}:${task.fromPortId}`
          : index === routePoints.length - 1
            ? `${task.toKind === "via_port" ? "via" : "breakout"}:${task.toPortId}`
            : `routing:${task.taskId}:${index}`,
      kind:
        index === 0
          ? task.fromKind
          : index === routePoints.length - 1
            ? task.toKind
            : "routing_point",
    }),
  )
  points[0] = {
    ...points[0]!,
    x: task.from.x,
    y: task.from.y,
  }
  points[points.length - 1] = {
    ...points.at(-1)!,
    x: task.to.x,
    y: task.to.y,
  }
  return { task, points, highDensityRoute: route }
}

const traceSegmentsFromPoints = (
  routeId: string,
  points: RoutePoint[],
): RoutedSegment[] =>
  points.slice(1).map((to, index) => ({
    kind: "trace",
    edgeKey: `high-density:${routeId}:${index}`,
    from: points[index]!,
    to,
  }))

const reversePoints = (points: RoutePoint[]) => [...points].reverse()

const getSolutionGeometryError = (solution: BoundaryRoutingSolution) =>
  getDifferentNetGeometryViolationError(solution, {
    traceThickness: TRACE_THICKNESS,
    viaDiameter: VIA_DIAMETER,
  })

export class HighDensityPhysicalRoutingSolver extends BaseSolver {
  private readonly tasks: PhysicalRoutingTask[]
  private readonly batches: PhysicalRoutingBatch[]
  private readonly physicalRouteByTaskId = new Map<string, PhysicalRoute>()
  private readonly completedHighDensityRoutes: HighDensityIntraNodeRoute[] = []
  private batchIndex = 0
  private totalExpandedStateCount = 0
  private totalRipCount = 0
  private readonly ripCountByTaskId = new Map<string, number>()
  private output: BoundaryRoutingSolution | null = null

  constructor(
    private readonly assignedProblem: AssignedBoundaryRoutingProblem,
  ) {
    super()
    this.tasks = buildPhysicalTasks(assignedProblem)
    const { problem, options } = assignedProblem.preparedProblem
    this.batches = buildPhysicalBatches(
      this.tasks,
      problem.viaBoundary,
      options.highDensityRoutingMargin,
    )
    this.MAX_ITERATIONS = 10_000
  }

  override getConstructorParams(): [AssignedBoundaryRoutingProblem] {
    return [this.assignedProblem]
  }

  override _step() {
    const batch = this.batches[this.batchIndex]
    if (!batch) {
      const candidate = this.buildSolution()
      const geometryError = getSolutionGeometryError(candidate)
      if (geometryError) {
        const fallback = new RipUpAStarBoundarySolver(
          this.assignedProblem.preparedProblem,
        )
        this.activeSubSolver = fallback
        fallback.solve()
        const fallbackOutput = fallback.getOutput()
        const fallbackGeometryError = fallbackOutput
          ? getSolutionGeometryError(fallbackOutput)
          : null
        if (fallback.solved && fallbackOutput && !fallbackGeometryError) {
          this.output = fallbackOutput
          this.solved = true
          this.progress = 1
          return
        }
        this.failed = true
        this.error = `high-density-b01 produced invalid different-net geometry: ${geometryError}; legacy fallback: ${
          fallbackGeometryError ?? fallback.error ?? "no route found"
        }`
        return
      }
      this.output = candidate
      this.solved = true
      this.progress = 1
      return
    }

    const { problem } = this.assignedProblem.preparedProblem
    const window = batch.window
    const currentBatchNetIds = new Set(batch.tasks.map((task) => task.netId))
    const approximationRectsByRoute = this.completedHighDensityRoutes
      .filter(
        (route) =>
          !currentBatchNetIds.has(route.rootConnectionName ?? "") &&
          !batch.tasks.some((task) => task.taskId === route.connectionName),
      )
      .map((route) => ({
        route,
        obstacles: approximateRouteWithRects(route, window),
      }))
      .filter(({ obstacles }) => obstacles.length > 0)
    const obstacles: HighDensityObstacle[] = [
      createBreakoutObstacle(problem.breakoutBoundary),
      ...approximationRectsByRoute.flatMap(({ obstacles }) => obstacles),
    ]
    const solver = new HighDensitySolverB01({
      nodeWithPortPoints: {
        capacityMeshNodeId: batch.batchId,
        center: {
          x: (window.minX + window.maxX) / 2,
          y: (window.minY + window.maxY) / 2,
        },
        width: window.maxX - window.minX,
        height: window.maxY - window.minY,
        availableZ: [0, 1],
        portPoints: batch.tasks.flatMap((task) => [
          {
            connectionName: task.taskId,
            rootConnectionName: task.netId,
            portPointId: `${task.taskId}:from:${task.fromPortId}`,
            x: task.from.x,
            y: task.from.y,
            z: 0,
          },
          {
            connectionName: task.taskId,
            rootConnectionName: task.netId,
            portPointId: `${task.taskId}:to:${task.toPortId}`,
            x: task.to.x,
            y: task.to.y,
            z: 0,
          },
        ]),
      },
      obstacles,
      highResolutionCellSize: HIGH_RESOLUTION_CELL_SIZE,
      highResolutionCellThickness: 8,
      lowResolutionCellSize: 0.4,
      traceThickness: TRACE_THICKNESS,
      traceMargin: TRACE_MARGIN,
      obstacleClearanceMargin: 0,
      viaDiameter: VIA_DIAMETER,
      viaMinDistFromBorder: 0,
      maxCellCount: 500_000,
      effort: 2,
    })
    this.activeSubSolver = solver
    solver.solve()
    this.totalExpandedStateCount += solver.iterations
    if (!solver.solved) {
      const batchNetIds = new Set(batch.tasks.map((task) => task.netId))
      const blockerTaskIds = [
        ...new Set(
          approximationRectsByRoute
            .filter(({ route }) => {
              return !batchNetIds.has(route.rootConnectionName ?? "")
            })
            .map(({ route }) => route.connectionName),
        ),
      ].filter((taskId) => (this.ripCountByTaskId.get(taskId) ?? 0) < 4)
      if (blockerTaskIds.length > 0) {
        const blockerTaskIdSet = new Set(blockerTaskIds)
        const blockerTasks = blockerTaskIds
          .map((taskId) => this.tasks.find((task) => task.taskId === taskId))
          .filter((task): task is PhysicalRoutingTask => Boolean(task))
        for (const task of blockerTasks) {
          this.ripCountByTaskId.set(
            task.taskId,
            (this.ripCountByTaskId.get(task.taskId) ?? 0) + 1,
          )
          this.physicalRouteByTaskId.delete(task.taskId)
          this.totalRipCount++
        }
        for (
          let index = this.completedHighDensityRoutes.length - 1;
          index >= 0;
          index--
        ) {
          if (
            blockerTaskIdSet.has(
              this.completedHighDensityRoutes[index]!.connectionName,
            )
          ) {
            this.completedHighDensityRoutes.splice(index, 1)
          }
        }
        const combinedTasks = [
          ...new Map(
            [...batch.tasks, ...blockerTasks].map((task) => [
              task.taskId,
              task,
            ]),
          ).values(),
        ]
        const combinedWindow = getSharedHighDensityRoutingWindow(
          combinedTasks,
          problem.viaBoundary,
          this.assignedProblem.preparedProblem.options.highDensityRoutingMargin,
        )
        if (combinedWindow) {
          this.batches[this.batchIndex] = {
            batchId: `conflict:${this.totalRipCount}:${batch.batchId}`,
            tasks: combinedTasks,
            window: combinedWindow,
          }
          return
        }
        this.batches.splice(
          this.batchIndex + 1,
          0,
          ...blockerTasks.map((task, index) => ({
            batchId: `reroute:${this.totalRipCount}:${index}:${task.taskId}`,
            tasks: [task],
            window: getHighDensityRoutingWindow(
              task.from,
              task.to,
              problem.viaBoundary,
              this.assignedProblem.preparedProblem.options
                .highDensityRoutingMargin,
            ),
          })),
        )
        return
      }
      const physicalError = `Physical batch "${batch.batchId}" (${batch.tasks
        .map((task) => task.taskId)
        .join(", ")}) failed in high-density-b01: ${
        solver.error ?? "no route found"
      }`
      // Keep legacy cases working while B01 is the primary physical stage.
      // This fallback is reached only after bounded local rip-up retries.
      const fallback = new RipUpAStarBoundarySolver(
        this.assignedProblem.preparedProblem,
      )
      this.activeSubSolver = fallback
      fallback.solve()
      const fallbackOutput = fallback.getOutput()
      const fallbackGeometryError = fallbackOutput
        ? getSolutionGeometryError(fallbackOutput)
        : null
      if (fallback.solved && fallbackOutput && !fallbackGeometryError) {
        this.output = fallbackOutput
        this.solved = true
        this.progress = 1
        return
      }
      this.failed = true
      this.error = `${physicalError}; legacy fallback: ${
        fallbackGeometryError ?? fallback.error ?? "no route found"
      }`
      return
    }
    const routesByConnectionName = Map.groupBy(
      solver.getOutput(),
      (route) => route.connectionName,
    )
    for (const task of batch.tasks) {
      const taskRoutes = routesByConnectionName.get(task.taskId)
      const route = taskRoutes?.[0]
      if (!route) {
        this.failed = true
        this.error = `high-density-b01 returned no route for "${task.taskId}"`
        return
      }
      const physicalRoute = toPhysicalRoute(task, route)
      this.physicalRouteByTaskId.set(task.taskId, physicalRoute)
    }
    this.completedHighDensityRoutes.push(...solver.getOutput())
    this.batchIndex++
    this.progress =
      this.batches.length === 0 ? 1 : this.batchIndex / this.batches.length
  }

  private buildSolution(): BoundaryRoutingSolution {
    const { preparedProblem, demandAssignmentByRouteId } = this.assignedProblem
    const routes: RoutedConnection[] = []
    let viaJumpCount = 0

    for (const demand of preparedProblem.demands) {
      const assignment = demandAssignmentByRouteId.get(demand.routeId)!
      if (!assignment.viaPair) {
        const physicalPoints = this.getConnectionPoints(
          `direct:${demand.routeId}`,
        )
        routes.push({
          routeId: demand.routeId,
          netId: demand.netId,
          sourcePortId: demand.sourcePortId,
          targetPortId: demand.targetPortId,
          points: physicalPoints,
          segments: traceSegmentsFromPoints(demand.routeId, physicalPoints),
          usedViaPortIds: [],
        })
        continue
      }

      const sourceViaPortId = assignment.sourceViaPortId!
      const targetViaPortId = assignment.targetViaPortId!
      const sourcePoints = this.getConnectionPoints(
        `leg:${demand.sourcePortId}->${sourceViaPortId}`,
      )
      const targetPoints = reversePoints(
        this.getConnectionPoints(
          `leg:${demand.targetPortId}->${targetViaPortId}`,
        ),
      )
      const segments: RoutedSegment[] = [
        ...traceSegmentsFromPoints(`${demand.routeId}:source`, sourcePoints),
      ]
      if (sourceViaPortId !== targetViaPortId) {
        viaJumpCount++
        segments.push({
          kind: "via_jump",
          edgeKey: `via:${[sourceViaPortId, targetViaPortId].sort().join(":")}`,
          from: sourcePoints.at(-1)!,
          to: targetPoints[0]!,
          entryPortId: sourceViaPortId,
          exitPortId: targetViaPortId,
        })
      }
      segments.push(
        ...traceSegmentsFromPoints(`${demand.routeId}:target`, targetPoints),
      )
      const points = segments.flatMap((segment, index) =>
        index === 0 ? [segment.from, segment.to] : [segment.to],
      )
      routes.push({
        routeId: demand.routeId,
        netId: demand.netId,
        sourcePortId: demand.sourcePortId,
        targetPortId: demand.targetPortId,
        points,
        segments,
        usedViaPortIds: [
          assignment.viaPair.firstPortId,
          assignment.viaPair.secondPortId,
        ],
      })
    }

    const stats: BoundaryRoutingStats = {
      routeCount: preparedProblem.demands.length,
      routedCount: routes.length,
      pendingCount: 0,
      ripCount: this.totalRipCount,
      expandedStateCount: this.totalExpandedStateCount,
      viaJumpCount,
      maxHistoryCost: 0,
    }
    return { routes, stats }
  }

  private getConnectionPoints(connectionId: string) {
    const connectionTasks = this.tasks
      .filter((task) => task.connectionId === connectionId)
      .sort((left, right) => left.segmentIndex - right.segmentIndex)
    const points: RoutePoint[] = []
    for (const task of connectionTasks) {
      const physicalRoute = this.physicalRouteByTaskId.get(task.taskId)
      if (!physicalRoute) {
        throw new Error(`Missing physical segment "${task.taskId}"`)
      }
      for (const point of physicalRoute.points) {
        const previous = points.at(-1)
        // B01 encodes a via as colocated points on different z layers. Do not
        // collapse that pair just because its x/y coordinates are equal.
        if (
          !previous ||
          !pointsEqual(previous, point) ||
          (previous.z ?? 0) !== (point.z ?? 0)
        ) {
          points.push(point)
        }
      }
    }
    return points
  }

  override getOutput() {
    return this.output
  }

  override visualize(): GraphicsObject {
    const initial = visualizeProblem(
      this.assignedProblem.preparedProblem.problem,
    )
    const solution = this.output
    if (!solution) return initial
    return {
      ...initial,
      title: `Assigned high-density routing (${solution.routes.length}/${solution.stats.routeCount})`,
      lines: [
        ...(initial.lines ?? []),
        ...solution.routes.flatMap((route) =>
          route.segments
            .filter(
              (segment): segment is Extract<RoutedSegment, { kind: "trace" }> =>
                segment.kind === "trace",
            )
            .map((segment) => ({
              points: [segment.from, segment.to],
              strokeColor: netColor(route.netId),
              strokeWidth: TRACE_THICKNESS,
              strokeDash:
                (segment.from.z ?? 0) === 1 &&
                (segment.to.z ?? segment.from.z ?? 0) === 1
                  ? "4 2"
                  : undefined,
            })),
        ),
      ],
    }
  }
}
