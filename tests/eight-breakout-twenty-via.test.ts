import { expect, test } from "bun:test"
import { type GraphicsObject, getSvgFromGraphicsObject } from "graphics-debug"
import { BoundaryRoutingPipelineSolver } from "../lib"
import {
  getUniqueViaPairs,
  getViaPairColor,
  getViaPairCurvePoints,
  netColor,
  segmentIntersectsRectInterior,
} from "../lib/geometry"
import { assertValidSolution } from "./fixtures/assert-valid-solution"
import { eightBreakoutTwentyViaProblem } from "./fixtures/eight-breakout-twenty-via-problem"

test("routes 8 breakout points through 20 paired via points", async () => {
  expect(eightBreakoutTwentyViaProblem.breakoutBoundary.ports).toHaveLength(8)
  expect(eightBreakoutTwentyViaProblem.viaBoundary.ports).toHaveLength(20)
  expect(
    eightBreakoutTwentyViaProblem.viaBoundary.ports.every(
      (port) =>
        port.y === eightBreakoutTwentyViaProblem.viaBoundary.minY ||
        port.y === eightBreakoutTwentyViaProblem.viaBoundary.maxY ||
        port.x === eightBreakoutTwentyViaProblem.viaBoundary.maxX,
    ),
  ).toBe(true)

  const viaPairs = getUniqueViaPairs(eightBreakoutTwentyViaProblem)
  const pairColors = viaPairs.map(([first, second]) =>
    getViaPairColor(eightBreakoutTwentyViaProblem, first.portId, second.portId),
  )
  expect(new Set(pairColors).size).toBe(viaPairs.length)
  for (const [first, second] of viaPairs) {
    const parabola = getViaPairCurvePoints(
      eightBreakoutTwentyViaProblem,
      first.portId,
      second.portId,
    )
    expect(parabola.length).toBeGreaterThanOrEqual(17)
    for (let index = 1; index < parabola.length; index++) {
      expect(
        segmentIntersectsRectInterior(
          parabola[index - 1]!,
          parabola[index]!,
          eightBreakoutTwentyViaProblem.viaBoundary,
        ),
      ).toBe(false)
    }
  }

  const solver = new BoundaryRoutingPipelineSolver(
    eightBreakoutTwentyViaProblem,
  )
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const solution = solver.getOutput()
  expect(solution).not.toBeNull()
  expect(solution!.stats.viaJumpCount).toBeGreaterThanOrEqual(3)
  expect(
    solution!.routes
      .flatMap((route) => route.points)
      .some((point) => point.kind === "routing_point"),
  ).toBe(true)
  const transitionSegments = solution!.routes
    .flatMap((route) => route.segments)
    .filter(
      (segment) =>
        segment.kind === "trace" &&
        (segment.from.z ?? 0) !== (segment.to.z ?? 0),
    )
  expect(transitionSegments.length).toBeGreaterThan(0)
  for (const segment of transitionSegments) {
    expect(segment.from.x).toBeCloseTo(segment.to.x)
    expect(segment.from.y).toBeCloseTo(segment.to.y)
  }
  assertValidSolution(eightBreakoutTwentyViaProblem, solution!)

  const svg = getSvgFromGraphicsObject(solver.visualize(), {
    backgroundColor: "white",
    svgWidth: 1000,
    svgHeight: 700,
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path)

  const layerTransitions = solution!.routes.flatMap((route) =>
    route.segments.flatMap((segment) => {
      if (
        segment.kind !== "trace" ||
        (segment.from.z ?? 0) === (segment.to.z ?? 0)
      ) {
        return []
      }
      return [{ route, point: segment.from }]
    }),
  )
  const layeredRoutingGraphics: GraphicsObject = {
    coordinateSystem: "cartesian",
    title: "Eight-breakout physical routing by copper layer",
    rects: [
      {
        center: {
          x:
            (eightBreakoutTwentyViaProblem.viaBoundary.minX +
              eightBreakoutTwentyViaProblem.viaBoundary.maxX) /
            2,
          y:
            (eightBreakoutTwentyViaProblem.viaBoundary.minY +
              eightBreakoutTwentyViaProblem.viaBoundary.maxY) /
            2,
        },
        width:
          eightBreakoutTwentyViaProblem.viaBoundary.maxX -
          eightBreakoutTwentyViaProblem.viaBoundary.minX,
        height:
          eightBreakoutTwentyViaProblem.viaBoundary.maxY -
          eightBreakoutTwentyViaProblem.viaBoundary.minY,
        stroke: "#6d28d9",
      },
      {
        center: {
          x:
            (eightBreakoutTwentyViaProblem.breakoutBoundary.minX +
              eightBreakoutTwentyViaProblem.breakoutBoundary.maxX) /
            2,
          y:
            (eightBreakoutTwentyViaProblem.breakoutBoundary.minY +
              eightBreakoutTwentyViaProblem.breakoutBoundary.maxY) /
            2,
        },
        width:
          eightBreakoutTwentyViaProblem.breakoutBoundary.maxX -
          eightBreakoutTwentyViaProblem.breakoutBoundary.minX,
        height:
          eightBreakoutTwentyViaProblem.breakoutBoundary.maxY -
          eightBreakoutTwentyViaProblem.breakoutBoundary.minY,
        stroke: "#475569",
      },
    ],
    points: [
      ...eightBreakoutTwentyViaProblem.breakoutBoundary.ports.map((port) => ({
        x: port.x,
        y: port.y,
        color: netColor(port.netId),
        label: `${port.portId} (${port.netId})`,
      })),
      ...eightBreakoutTwentyViaProblem.viaBoundary.ports.map((port) => ({
        x: port.x,
        y: port.y,
        color: "#6d28d9",
        label: port.portId,
      })),
    ],
    lines: solution!.routes.flatMap((route) =>
      route.segments.flatMap((segment) => {
        if (segment.kind !== "trace") return []
        const layer = segment.from.z ?? 0
        return [
          {
            points: [segment.from, segment.to],
            strokeColor: netColor(route.netId),
            strokeWidth: 0.1,
            strokeDash: layer === 1 ? "4 2" : undefined,
            label: `${route.netId} z=${layer}`,
          },
        ]
      }),
    ),
    circles: layerTransitions.map(({ route, point }) => ({
      center: point,
      radius: 0.15,
      fill: "white",
      stroke: netColor(route.netId),
      label: `${route.netId} via`,
    })),
  }
  const layeredRoutingSvg = getSvgFromGraphicsObject(layeredRoutingGraphics, {
    backgroundColor: "white",
    svgWidth: 1000,
    svgHeight: 700,
  })
  await expect(layeredRoutingSvg).toMatchSvgSnapshot(
    import.meta.path,
    "layered-routing",
  )
})
