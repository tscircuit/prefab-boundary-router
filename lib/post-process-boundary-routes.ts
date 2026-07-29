import {
  closestPointOnSegment,
  GEOMETRY_EPSILON,
  segmentIntersectsRectInterior,
  segmentsIntersect,
  segmentToSegmentDistance,
} from "./geometry"
import type {
  BoundaryRoutingProblem,
  Point,
  RoutedConnection,
  RoutedSegment,
} from "./types"

export const DEFAULT_TRACE_CLEARANCE_MARGIN = 0.15

interface PointForce {
  routeIndex: number
  nodeId: string
  x: number
  y: number
  count: number
}

const isTrace = (
  segment: RoutedSegment,
): segment is Extract<RoutedSegment, { kind: "trace" }> =>
  segment.kind === "trace"

const updateRoutePoint = (
  route: RoutedConnection,
  nodeId: string,
  position: Point,
) => {
  for (const segment of route.segments) {
    if (segment.from.nodeId === nodeId) Object.assign(segment.from, position)
    if (segment.to.nodeId === nodeId) Object.assign(segment.to, position)
  }
}

const keepInsideViaBoundary = (
  point: Point,
  problem: BoundaryRoutingProblem,
) => ({
  x: Math.max(
    problem.viaBoundary.minX + 0.01,
    Math.min(problem.viaBoundary.maxX - 0.01, point.x),
  ),
  y: Math.max(
    problem.viaBoundary.minY + 0.01,
    Math.min(problem.viaBoundary.maxY - 0.01, point.y),
  ),
})

const pointIsInsideBreakout = (point: Point, problem: BoundaryRoutingProblem) =>
  point.x > problem.breakoutBoundary.minX + GEOMETRY_EPSILON &&
  point.x < problem.breakoutBoundary.maxX - GEOMETRY_EPSILON &&
  point.y > problem.breakoutBoundary.minY + GEOMETRY_EPSILON &&
  point.y < problem.breakoutBoundary.maxY - GEOMETRY_EPSILON

const moveRoutingPointsApart = (
  routes: RoutedConnection[],
  problem: BoundaryRoutingProblem,
  targetMargin: number,
) => {
  for (let iteration = 0; iteration < 300; iteration++) {
    const forceByPoint = new Map<string, PointForce>()
    let violationCount = 0

    for (
      let firstRouteIndex = 0;
      firstRouteIndex < routes.length;
      firstRouteIndex++
    ) {
      const firstRoute = routes[firstRouteIndex]!
      for (
        let secondRouteIndex = firstRouteIndex + 1;
        secondRouteIndex < routes.length;
        secondRouteIndex++
      ) {
        const secondRoute = routes[secondRouteIndex]!
        if (firstRoute.netId === secondRoute.netId) continue
        for (const firstSegment of firstRoute.segments) {
          if (!isTrace(firstSegment)) continue
          for (const secondSegment of secondRoute.segments) {
            if (
              !isTrace(secondSegment) ||
              segmentToSegmentDistance(
                firstSegment.from,
                firstSegment.to,
                secondSegment.from,
                secondSegment.to,
              ) >= targetMargin
            ) {
              continue
            }
            violationCount++
            const movableEndpoints = [
              {
                routeIndex: firstRouteIndex,
                point: firstSegment.from,
                obstacle: secondSegment,
              },
              {
                routeIndex: firstRouteIndex,
                point: firstSegment.to,
                obstacle: secondSegment,
              },
              {
                routeIndex: secondRouteIndex,
                point: secondSegment.from,
                obstacle: firstSegment,
              },
              {
                routeIndex: secondRouteIndex,
                point: secondSegment.to,
                obstacle: firstSegment,
              },
            ]
            for (const { routeIndex, point, obstacle } of movableEndpoints) {
              if (point.kind !== "routing_point") continue
              const closestPoint = closestPointOnSegment(
                point,
                obstacle.from,
                obstacle.to,
              )
              let deltaX = point.x - closestPoint.x
              let deltaY = point.y - closestPoint.y
              let distance = Math.hypot(deltaX, deltaY)
              if (distance >= targetMargin) continue
              if (distance < GEOMETRY_EPSILON) {
                deltaX = -(obstacle.to.y - obstacle.from.y)
                deltaY = obstacle.to.x - obstacle.from.x
                distance = Math.hypot(deltaX, deltaY)
              }
              const strength =
                (targetMargin - distance) / Math.max(distance, GEOMETRY_EPSILON)
              const key = `${routeIndex}:${point.nodeId}`
              const force = forceByPoint.get(key) ?? {
                routeIndex,
                nodeId: point.nodeId,
                x: 0,
                y: 0,
                count: 0,
              }
              force.x += deltaX * strength
              force.y += deltaY * strength
              force.count++
              forceByPoint.set(key, force)
            }
          }
        }
      }
    }

    if (violationCount === 0) return

    for (const force of forceByPoint.values()) {
      const route = routes[force.routeIndex]!
      const point = route.segments
        .flatMap((segment) => [segment.from, segment.to])
        .find((candidate) => candidate.nodeId === force.nodeId)!
      const forceMagnitude = Math.hypot(force.x, force.y)
      if (forceMagnitude < GEOMETRY_EPSILON) continue
      const step = Math.min(0.04, forceMagnitude / force.count)
      const candidate = keepInsideViaBoundary(
        {
          x: point.x + (force.x / forceMagnitude) * step,
          y: point.y + (force.y / forceMagnitude) * step,
        },
        problem,
      )
      if (pointIsInsideBreakout(candidate, problem)) continue

      const previousPosition = { x: point.x, y: point.y }
      updateRoutePoint(route, force.nodeId, candidate)
      const movedSegments = route.segments.filter(
        (segment) =>
          isTrace(segment) &&
          (segment.from.nodeId === force.nodeId ||
            segment.to.nodeId === force.nodeId),
      )
      const invalidMove =
        movedSegments.some((segment) =>
          segmentIntersectsRectInterior(
            segment.from,
            segment.to,
            problem.breakoutBoundary,
          ),
        ) ||
        routes.some(
          (otherRoute, otherRouteIndex) =>
            otherRouteIndex !== force.routeIndex &&
            otherRoute.netId !== route.netId &&
            movedSegments.some((movedSegment) =>
              otherRoute.segments.some(
                (otherSegment) =>
                  isTrace(otherSegment) &&
                  segmentsIntersect(
                    movedSegment.from,
                    movedSegment.to,
                    otherSegment.from,
                    otherSegment.to,
                  ),
              ),
            ),
        )
      if (invalidMove) {
        updateRoutePoint(route, force.nodeId, previousPosition)
      }
    }
  }
}

const shortcutRoutes = (
  routes: RoutedConnection[],
  problem: BoundaryRoutingProblem,
  clearanceMargin: number,
) => {
  let changed = true
  while (changed) {
    changed = false
    for (const route of routes) {
      for (let index = 0; index < route.segments.length - 1; index++) {
        const firstSegment = route.segments[index]!
        const secondSegment = route.segments[index + 1]!
        if (
          !isTrace(firstSegment) ||
          !isTrace(secondSegment) ||
          firstSegment.to.nodeId !== secondSegment.from.nodeId ||
          firstSegment.to.kind !== "routing_point"
        ) {
          continue
        }
        const shortcut = {
          ...firstSegment,
          edgeKey: `shortcut:${route.routeId}:${index}`,
          to: secondSegment.to,
        }
        if (
          segmentIntersectsRectInterior(
            shortcut.from,
            shortcut.to,
            problem.breakoutBoundary,
          )
        ) {
          continue
        }
        const violatesClearance = routes.some(
          (otherRoute) =>
            otherRoute.netId !== route.netId &&
            otherRoute.segments.some(
              (otherSegment) =>
                isTrace(otherSegment) &&
                segmentToSegmentDistance(
                  shortcut.from,
                  shortcut.to,
                  otherSegment.from,
                  otherSegment.to,
                ) <
                  clearanceMargin - GEOMETRY_EPSILON,
            ),
        )
        if (violatesClearance) continue
        route.segments.splice(index, 2, shortcut)
        changed = true
        index--
      }
    }
  }
}

const normalizeRouteGeometry = (route: RoutedConnection) => {
  route.segments = route.segments.map((segment, segmentIndex) => {
    const normalizePoint = (point: typeof segment.from) =>
      point.kind === "routing_point"
        ? {
            ...point,
            nodeId: `routing:${point.x}:${point.y}`,
          }
        : point
    return {
      ...segment,
      edgeKey:
        segment.kind === "trace"
          ? `postprocessed:${route.routeId}:${segmentIndex}`
          : segment.edgeKey,
      from: normalizePoint(segment.from),
      to: normalizePoint(segment.to),
    }
  })
  route.points = route.segments.flatMap((segment) => [segment.from, segment.to])
}

export const getMinimumDifferentNetTraceClearance = (
  routes: readonly RoutedConnection[],
) => {
  let minimumClearance = Number.POSITIVE_INFINITY
  for (
    let firstRouteIndex = 0;
    firstRouteIndex < routes.length;
    firstRouteIndex++
  ) {
    const firstRoute = routes[firstRouteIndex]!
    for (
      let secondRouteIndex = firstRouteIndex + 1;
      secondRouteIndex < routes.length;
      secondRouteIndex++
    ) {
      const secondRoute = routes[secondRouteIndex]!
      if (firstRoute.netId === secondRoute.netId) continue
      for (const firstSegment of firstRoute.segments) {
        if (!isTrace(firstSegment)) continue
        for (const secondSegment of secondRoute.segments) {
          if (!isTrace(secondSegment)) continue
          minimumClearance = Math.min(
            minimumClearance,
            segmentToSegmentDistance(
              firstSegment.from,
              firstSegment.to,
              secondSegment.from,
              secondSegment.to,
            ),
          )
        }
      }
    }
  }
  return minimumClearance
}

export const postProcessBoundaryRoutes = (
  problem: BoundaryRoutingProblem,
  inputRoutes: readonly RoutedConnection[],
  clearanceMargin = DEFAULT_TRACE_CLEARANCE_MARGIN,
) => {
  const routes = structuredClone(inputRoutes) as RoutedConnection[]
  moveRoutingPointsApart(routes, problem, clearanceMargin + 0.01)
  shortcutRoutes(routes, problem, clearanceMargin)
  for (const route of routes) normalizeRouteGeometry(route)
  return routes
}
