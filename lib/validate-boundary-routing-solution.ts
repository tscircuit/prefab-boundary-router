import {
  findRouteGeometryViolations,
  formatRouteGeometryViolations,
  type HighDensityIntraNodeRoute,
  type RouteGeometryViolation,
} from "@tscircuit/high-density-b01"
import { pointsEqual } from "./geometry"
import type {
  BoundaryRoutingSolution,
  RoutedConnection,
  RoutePoint,
} from "./types"

const DEFAULT_TRACE_THICKNESS = 0.1
const DEFAULT_VIA_DIAMETER = 0.3

export interface BoundaryRoutingGeometryValidationOptions {
  /** Physical trace width used when checking copper overlap. */
  traceThickness?: number
  /** Physical diameter of B01 layer-transition vias. */
  viaDiameter?: number
  /** Additional required spacing between different nets. */
  clearance?: number
}

export type BoundaryRoutingGeometryViolation = RouteGeometryViolation

const routePointsEqual = (first: RoutePoint, second: RoutePoint) =>
  pointsEqual(first, second) && (first.z ?? 0) === (second.z ?? 0)

const getCopperComponents = (route: RoutedConnection) => {
  const components: RoutePoint[][] = []
  let points: RoutePoint[] = []
  const flush = () => {
    if (points.length >= 2) components.push(points)
    points = []
  }

  for (const segment of route.segments) {
    if (segment.kind === "via_jump") {
      flush()
      continue
    }
    if (points.length > 0 && !routePointsEqual(points.at(-1)!, segment.from)) {
      flush()
    }
    if (points.length === 0) points.push(segment.from)
    points.push(segment.to)
  }
  flush()
  return components
}

const toHighDensityRoutes = (
  solution: BoundaryRoutingSolution,
  options: Required<BoundaryRoutingGeometryValidationOptions>,
): HighDensityIntraNodeRoute[] => {
  const traceThickness = options.traceThickness + options.clearance
  const viaDiameter = options.viaDiameter + options.clearance
  return solution.routes.flatMap((route) =>
    getCopperComponents(route).map((points, componentIndex) => {
      const vias = points.flatMap((point, index) => {
        if (point.kind === "via_port") {
          return [{ x: point.x, y: point.y }]
        }
        if (index === 0) return []
        const beforePrevious = points[index - 1]!
        if ((beforePrevious.z ?? 0) === (point.z ?? 0)) return []
        return [
          {
            x: (beforePrevious.x + point.x) / 2,
            y: (beforePrevious.y + point.y) / 2,
          },
        ]
      })
      return {
        connectionName: `${route.routeId}:copper:${componentIndex}`,
        rootConnectionName: route.netId,
        traceThickness,
        viaDiameter,
        route: points.map((point) => ({
          x: point.x,
          y: point.y,
          z: point.z ?? 0,
        })),
        vias,
      }
    }),
  )
}

const normalizeOptions = (
  options: BoundaryRoutingGeometryValidationOptions,
): Required<BoundaryRoutingGeometryValidationOptions> => {
  const normalized = {
    traceThickness: options.traceThickness ?? DEFAULT_TRACE_THICKNESS,
    viaDiameter: options.viaDiameter ?? DEFAULT_VIA_DIAMETER,
    clearance: options.clearance ?? 0,
  }
  for (const [name, value] of Object.entries(normalized)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} must be a non-negative finite number`)
    }
  }
  return normalized
}

export const findDifferentNetGeometryViolations = (
  solution: BoundaryRoutingSolution,
  options: BoundaryRoutingGeometryValidationOptions = {},
): BoundaryRoutingGeometryViolation[] =>
  findRouteGeometryViolations(
    toHighDensityRoutes(solution, normalizeOptions(options)),
  )

export const getDifferentNetGeometryViolationError = (
  solution: BoundaryRoutingSolution,
  options: BoundaryRoutingGeometryValidationOptions = {},
) => {
  const violations = findDifferentNetGeometryViolations(solution, options)
  if (violations.length === 0) return null
  return `Found ${violations.length} different-net geometry violation(s):\n${formatRouteGeometryViolations(
    violations,
  )}`
}

export const validateBoundaryRoutingSolutionGeometry = (
  solution: BoundaryRoutingSolution,
  options: BoundaryRoutingGeometryValidationOptions = {},
) => {
  const error = getDifferentNetGeometryViolationError(solution, options)
  if (error) throw new Error(error)
}
