import { expect, test } from "bun:test"
import {
  findDifferentNetGeometryViolations,
  type RoutedConnection,
  type RoutePoint,
  validateBoundaryRoutingSolutionGeometry,
} from "../lib"

const makeRoute = (
  routeId: string,
  netId: string,
  points: RoutePoint[],
): RoutedConnection => ({
  routeId,
  netId,
  sourcePortId: `${routeId}:source`,
  targetPortId: `${routeId}:target`,
  points,
  segments: points.slice(1).map((to, index) => ({
    kind: "trace",
    edgeKey: `${routeId}:${index}`,
    from: points[index]!,
    to,
  })),
  usedViaPortIds: [],
})

const point = (x: number, y: number, z = 0): RoutePoint => ({
  x,
  y,
  z,
  nodeId: `${x}:${y}:${z}`,
  kind: "routing_point",
})

const solutionWith = (...routes: RoutedConnection[]) => ({
  routes,
  stats: {
    routeCount: routes.length,
    routedCount: routes.length,
    pendingCount: 0,
    ripCount: 0,
    expandedStateCount: 0,
    viaJumpCount: 0,
    maxHistoryCost: 0,
  },
})

test("rejects a same-layer intersection between different nets", () => {
  const solution = solutionWith(
    makeRoute("horizontal", "net-a", [point(-1, 0), point(1, 0)]),
    makeRoute("vertical", "net-b", [point(0, -1), point(0, 1)]),
  )

  const violations = findDifferentNetGeometryViolations(solution)
  expect(
    violations.some(
      (violation) =>
        violation.type === "crossing" || violation.type === "shared_point",
    ),
  ).toBe(true)
  expect(() => validateBoundaryRoutingSolutionGeometry(solution)).toThrow(
    "different-net geometry violation",
  )
})

test("allows crossings on separate copper layers", () => {
  const solution = solutionWith(
    makeRoute("top", "net-a", [point(-1, 0, 0), point(1, 0, 0)]),
    makeRoute("bottom", "net-b", [point(0, -1, 1), point(0, 1, 1)]),
  )

  expect(findDifferentNetGeometryViolations(solution)).toEqual([])
  expect(() => validateBoundaryRoutingSolutionGeometry(solution)).not.toThrow()
})

test("ignores intersections within one net", () => {
  const solution = solutionWith(
    makeRoute("branch-a", "shared-net", [point(-1, 0), point(1, 0)]),
    makeRoute("branch-b", "shared-net", [point(0, -1), point(0, 1)]),
  )

  expect(findDifferentNetGeometryViolations(solution)).toEqual([])
})

test("detects a different-net trace passing through a layer-transition via", () => {
  const solution = solutionWith(
    makeRoute("via", "net-a", [point(0, 0, 0), point(0, 0, 1)]),
    makeRoute("trace", "net-b", [point(-1, 0.1, 0), point(1, 0.1, 0)]),
  )

  expect(
    findDifferentNetGeometryViolations(solution).some(
      (violation) => violation.type === "via_trace_clearance",
    ),
  ).toBe(true)
})

test("detects overlapping layer-transition vias from different nets", () => {
  const solution = solutionWith(
    makeRoute("via-a", "net-a", [point(0, 0, 0), point(0, 0, 1)]),
    makeRoute("via-b", "net-b", [point(0.1, 0, 0), point(0.1, 0, 1)]),
  )

  expect(
    findDifferentNetGeometryViolations(solution).some(
      (violation) => violation.type === "via_via_clearance",
    ),
  ).toBe(true)
})

test("treats assigned via-port endpoints as physical via geometry", () => {
  const viaPoint = { ...point(0, 0), kind: "via_port" as const }
  const solution = solutionWith(
    makeRoute("assigned-via", "net-a", [viaPoint, point(0, 1)]),
    makeRoute("nearby-trace", "net-b", [point(-1, -0.1), point(1, -0.1)]),
  )

  expect(
    findDifferentNetGeometryViolations(solution).some(
      (violation) => violation.type === "via_trace_clearance",
    ),
  ).toBe(true)
})
