import type { GraphicsObject } from "graphics-debug"
import type {
  BoundaryRoutingProblem,
  Point,
  RectBounds,
  RoutedSegment,
  ViaPort,
} from "./types"

export const GEOMETRY_EPSILON = 1e-7

export const nearlyEqual = (a: number, b: number) =>
  Math.abs(a - b) <= GEOMETRY_EPSILON

export const pointsEqual = (a: Point, b: Point) =>
  nearlyEqual(a.x, b.x) && nearlyEqual(a.y, b.y)

export const pointDistance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y)

export const isPointOnRectBoundary = (point: Point, rect: RectBounds) => {
  const withinX =
    point.x >= rect.minX - GEOMETRY_EPSILON &&
    point.x <= rect.maxX + GEOMETRY_EPSILON
  const withinY =
    point.y >= rect.minY - GEOMETRY_EPSILON &&
    point.y <= rect.maxY + GEOMETRY_EPSILON
  return (
    withinX &&
    withinY &&
    (nearlyEqual(point.x, rect.minX) ||
      nearlyEqual(point.x, rect.maxX) ||
      nearlyEqual(point.y, rect.minY) ||
      nearlyEqual(point.y, rect.maxY))
  )
}

export const rectStrictlyContains = (outer: RectBounds, inner: RectBounds) =>
  outer.minX < inner.minX - GEOMETRY_EPSILON &&
  outer.minY < inner.minY - GEOMETRY_EPSILON &&
  outer.maxX > inner.maxX + GEOMETRY_EPSILON &&
  outer.maxY > inner.maxY + GEOMETRY_EPSILON

const orientation = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

export const pointOnSegment = (point: Point, a: Point, b: Point) =>
  Math.abs(orientation(a, b, point)) <= GEOMETRY_EPSILON &&
  point.x >= Math.min(a.x, b.x) - GEOMETRY_EPSILON &&
  point.x <= Math.max(a.x, b.x) + GEOMETRY_EPSILON &&
  point.y >= Math.min(a.y, b.y) - GEOMETRY_EPSILON &&
  point.y <= Math.max(a.y, b.y) + GEOMETRY_EPSILON

export const segmentsIntersect = (
  firstA: Point,
  firstB: Point,
  secondA: Point,
  secondB: Point,
) => {
  const o1 = orientation(firstA, firstB, secondA)
  const o2 = orientation(firstA, firstB, secondB)
  const o3 = orientation(secondA, secondB, firstA)
  const o4 = orientation(secondA, secondB, firstB)

  if (
    ((o1 > GEOMETRY_EPSILON && o2 < -GEOMETRY_EPSILON) ||
      (o1 < -GEOMETRY_EPSILON && o2 > GEOMETRY_EPSILON)) &&
    ((o3 > GEOMETRY_EPSILON && o4 < -GEOMETRY_EPSILON) ||
      (o3 < -GEOMETRY_EPSILON && o4 > GEOMETRY_EPSILON))
  ) {
    return true
  }
  return (
    (Math.abs(o1) <= GEOMETRY_EPSILON &&
      pointOnSegment(secondA, firstA, firstB)) ||
    (Math.abs(o2) <= GEOMETRY_EPSILON &&
      pointOnSegment(secondB, firstA, firstB)) ||
    (Math.abs(o3) <= GEOMETRY_EPSILON &&
      pointOnSegment(firstA, secondA, secondB)) ||
    (Math.abs(o4) <= GEOMETRY_EPSILON &&
      pointOnSegment(firstB, secondA, secondB))
  )
}

export const segmentIntersectsRectInterior = (
  a: Point,
  b: Point,
  rect: RectBounds,
) => {
  const inner = {
    minX: rect.minX + GEOMETRY_EPSILON,
    minY: rect.minY + GEOMETRY_EPSILON,
    maxX: rect.maxX - GEOMETRY_EPSILON,
    maxY: rect.maxY - GEOMETRY_EPSILON,
  }
  let minT = 0
  let maxT = 1
  const axes: Array<[number, number, number, number]> = [
    [a.x, b.x - a.x, inner.minX, inner.maxX],
    [a.y, b.y - a.y, inner.minY, inner.maxY],
  ]
  for (const [start, delta, min, max] of axes) {
    if (Math.abs(delta) <= GEOMETRY_EPSILON) {
      if (start < min || start > max) return false
      continue
    }
    const firstT = (min - start) / delta
    const secondT = (max - start) / delta
    minT = Math.max(minT, Math.min(firstT, secondT))
    maxT = Math.min(maxT, Math.max(firstT, secondT))
    if (maxT < minT) return false
  }
  return maxT >= minT
}

export const traceSegmentsIntersect = (
  first: RoutedSegment,
  second: RoutedSegment,
) =>
  first.kind === "trace" &&
  second.kind === "trace" &&
  segmentsIntersect(first.from, first.to, second.from, second.to)

const rectGraphic = (rect: RectBounds, stroke: string) => ({
  center: {
    x: (rect.minX + rect.maxX) / 2,
    y: (rect.minY + rect.maxY) / 2,
  },
  width: rect.maxX - rect.minX,
  height: rect.maxY - rect.minY,
  stroke,
})

const rectOutline = (rect: RectBounds, strokeColor: string, label: string) => ({
  points: [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
    { x: rect.minX, y: rect.minY },
  ],
  strokeColor,
  strokeWidth: 0.1,
  label,
})

export const netColor = (netId: string) => {
  const palette = [
    "#e11d48",
    "#2563eb",
    "#16a34a",
    "#d97706",
    "#7c3aed",
    "#0891b2",
    "#db2777",
    "#65a30d",
  ]
  let hash = 0
  for (const character of netId) {
    hash = Math.imul(hash, 31) + character.charCodeAt(0)
  }
  return palette[Math.abs(hash) % palette.length]!
}

export const getUniqueViaPairs = (problem: BoundaryRoutingProblem) => {
  const viaById = new Map(
    problem.viaBoundary.ports.map((port) => [port.portId, port]),
  )
  const seen = new Set<string>()
  const pairs: Array<[ViaPort, ViaPort]> = []
  for (const port of problem.viaBoundary.ports) {
    const pairKey = [port.portId, port.pairedPortId].sort().join(":")
    if (seen.has(pairKey)) continue
    const pairedPort = viaById.get(port.pairedPortId)
    if (!pairedPort) continue
    seen.add(pairKey)
    pairs.push([port, pairedPort])
  }
  return pairs
}

const outwardPoint = (point: Point, rect: RectBounds, padding: number) => {
  if (nearlyEqual(point.y, rect.minY)) {
    return { x: point.x, y: rect.minY - padding }
  }
  if (nearlyEqual(point.x, rect.maxX)) {
    return { x: rect.maxX + padding, y: point.y }
  }
  if (nearlyEqual(point.y, rect.maxY)) {
    return { x: point.x, y: rect.maxY + padding }
  }
  return { x: rect.minX - padding, y: point.y }
}

type RectSide = "top" | "right" | "bottom" | "left"

const getRectSide = (point: Point, rect: RectBounds): RectSide => {
  if (nearlyEqual(point.y, rect.minY)) return "top"
  if (nearlyEqual(point.x, rect.maxX)) return "right"
  if (nearlyEqual(point.y, rect.maxY)) return "bottom"
  return "left"
}

const quadraticBezierPoint = (
  start: Point,
  control: Point,
  end: Point,
  t: number,
) => {
  const inverseT = 1 - t
  return {
    x:
      inverseT * inverseT * start.x +
      2 * inverseT * t * control.x +
      t * t * end.x,
    y:
      inverseT * inverseT * start.y +
      2 * inverseT * t * control.y +
      t * t * end.y,
  }
}

const sampleParabola = (
  start: Point,
  control: Point,
  end: Point,
  pairIndex: number,
) => {
  const segmentCount = 15 + (pairIndex % 5)
  const spacingExponent = 0.9 + (pairIndex % 4) * 0.07
  return Array.from({ length: segmentCount + 1 }, (_, index) => {
    const evenlySpacedT = index / segmentCount
    const t = evenlySpacedT ** spacingExponent
    return quadraticBezierPoint(start, control, end, t)
  })
}

const parabolaStaysOutside = (points: Point[], rect: RectBounds) => {
  for (let index = 1; index < points.length; index++) {
    if (
      segmentIntersectsRectInterior(points[index - 1]!, points[index]!, rect)
    ) {
      return false
    }
  }
  return true
}

const getParabolaControl = (
  first: Point,
  second: Point,
  firstSide: RectSide,
  secondSide: RectSide,
  rect: RectBounds,
  bulge: number,
  pairIndex: number,
) => {
  const middle = {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  }
  const jitter =
    (((pairIndex * 37) % 11) - 5) *
    Math.min(rect.maxX - rect.minX, rect.maxY - rect.minY) *
    0.018

  if (firstSide === secondSide) {
    if (firstSide === "top") {
      return { x: middle.x + jitter, y: rect.minY - bulge }
    }
    if (firstSide === "right") {
      return { x: rect.maxX + bulge, y: middle.y + jitter }
    }
    if (firstSide === "bottom") {
      return { x: middle.x + jitter, y: rect.maxY + bulge }
    }
    return { x: rect.minX - bulge, y: middle.y + jitter }
  }

  const sideKey = new Set([firstSide, secondSide])
  if (sideKey.has("top") && sideKey.has("bottom")) {
    return pairIndex % 2 === 0
      ? { x: rect.minX - bulge, y: middle.y + jitter }
      : { x: rect.maxX + bulge, y: middle.y + jitter }
  }
  if (sideKey.has("left") && sideKey.has("right")) {
    return pairIndex % 2 === 0
      ? { x: middle.x + jitter, y: rect.minY - bulge }
      : { x: middle.x + jitter, y: rect.maxY + bulge }
  }
  if (sideKey.has("top") && sideKey.has("right")) {
    return {
      x: rect.maxX + bulge + jitter,
      y: rect.minY - bulge + jitter * 0.4,
    }
  }
  if (sideKey.has("right") && sideKey.has("bottom")) {
    return {
      x: rect.maxX + bulge + jitter * 0.4,
      y: rect.maxY + bulge + jitter,
    }
  }
  if (sideKey.has("bottom") && sideKey.has("left")) {
    return {
      x: rect.minX - bulge + jitter,
      y: rect.maxY + bulge + jitter * 0.4,
    }
  }
  return {
    x: rect.minX - bulge + jitter * 0.4,
    y: rect.minY - bulge + jitter,
  }
}

const findViaPair = (
  problem: BoundaryRoutingProblem,
  firstPortId: string,
  secondPortId: string,
) => {
  const pairs = getUniqueViaPairs(problem)
  const pairIndex = pairs.findIndex(([first, second]) => {
    const portIds = new Set([first.portId, second.portId])
    return portIds.has(firstPortId) && portIds.has(secondPortId)
  })
  return { pair: pairs[pairIndex], pairIndex }
}

export const getViaPairColor = (
  problem: BoundaryRoutingProblem,
  firstPortId: string,
  secondPortId: string,
) => {
  const { pairIndex } = findViaPair(problem, firstPortId, secondPortId)
  const hue = ((Math.max(0, pairIndex) * 137.508 + 8) % 360).toFixed(1)
  return `hsl(${hue}, 78%, 46%)`
}

export const getViaPairCurvePoints = (
  problem: BoundaryRoutingProblem,
  firstPortId: string,
  secondPortId: string,
) => {
  const { pair, pairIndex } = findViaPair(problem, firstPortId, secondPortId)
  if (!pair) return []

  const rect = problem.viaBoundary
  const padding = 2 + (pairIndex % 4) * 0.38
  const firstOut = outwardPoint(pair[0], rect, padding)
  const secondOut = outwardPoint(pair[1], rect, padding * 0.92)
  const firstSide = getRectSide(pair[0], rect)
  const secondSide = getRectSide(pair[1], rect)
  const maximumDimension = Math.max(
    rect.maxX - rect.minX,
    rect.maxY - rect.minY,
  )
  let lastParabola: Point[] = []

  for (let attempt = 0; attempt < 24; attempt++) {
    const bulge =
      maximumDimension * (0.45 + (pairIndex % 5) * 0.045 + attempt * 0.18)
    const control = getParabolaControl(
      firstOut,
      secondOut,
      firstSide,
      secondSide,
      rect,
      bulge,
      pairIndex,
    )
    const parabola = sampleParabola(firstOut, control, secondOut, pairIndex)
    lastParabola = parabola
    const completeCurve = [pair[0], ...parabola, pair[1]]
    if (parabolaStaysOutside(completeCurve, rect)) return completeCurve
  }

  return [pair[0], ...lastParabola, pair[1]]
}

export const visualizeProblem = (
  problem: BoundaryRoutingProblem,
  {
    viaPortNetIdByPortId = new Map(),
  }: {
    viaPortNetIdByPortId?: ReadonlyMap<string, string>
  } = {},
): GraphicsObject => ({
  coordinateSystem: "cartesian",
  title: "Vector boundary routing problem",
  rects: [
    rectGraphic(problem.viaBoundary, "#6d28d9"),
    rectGraphic(problem.breakoutBoundary, "#475569"),
  ],
  points: [
    ...problem.breakoutBoundary.ports.map((port) => ({
      x: port.x,
      y: port.y,
      color: netColor(port.netId),
      label: `${port.portId} (${port.netId})`,
    })),
    ...problem.viaBoundary.ports.map((port) => ({
      x: port.x,
      y: port.y,
      color: viaPortNetIdByPortId.has(port.portId)
        ? netColor(viaPortNetIdByPortId.get(port.portId)!)
        : "#7c3aed",
      label: `${port.portId} → ${port.pairedPortId}`,
    })),
  ],
  lines: [
    rectOutline(problem.viaBoundary, "#6d28d9", "via boundary"),
    rectOutline(problem.breakoutBoundary, "#475569", "breakout boundary"),
    ...getUniqueViaPairs(problem).map(([first, second]) => ({
      points: getViaPairCurvePoints(problem, first.portId, second.portId),
      strokeColor:
        viaPortNetIdByPortId.get(first.portId) ===
          viaPortNetIdByPortId.get(second.portId) &&
        viaPortNetIdByPortId.has(first.portId)
          ? netColor(viaPortNetIdByPortId.get(first.portId)!)
          : getViaPairColor(problem, first.portId, second.portId),
      strokeWidth: 0.065,
      strokeDash: "2.5 3",
      label: `${first.portId} ↔ ${second.portId}`,
    })),
  ],
  circles: [],
})
