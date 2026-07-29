import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { BoundaryRoutingPipelineSolver } from "../lib"
import {
  getUniqueViaPairs,
  getViaPairColor,
  getViaPairCurvePoints,
  netColor,
  segmentIntersectsRectInterior,
  visualizeProblem,
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
  const assignedVisualization = visualizeProblem(
    eightBreakoutTwentyViaProblem,
    {
      viaPortNetIdByPortId: new Map([
        ["via-0", "connectivity_net_A"],
        ["via-10", "connectivity_net_A"],
      ]),
    },
  )
  expect(
    assignedVisualization.lines?.find((line) => line.label === "via-0 ↔ via-10")
      ?.strokeColor,
  ).toBe(netColor("connectivity_net_A"))
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
  const layerTransitions = solution!.routes
    .flatMap((route) => route.segments)
    .filter(
      (segment) =>
        segment.kind === "trace" &&
        (segment.from.z ?? 0) !== (segment.to.z ?? 0),
    )
  expect(layerTransitions.length).toBeGreaterThan(0)
  for (const segment of layerTransitions) {
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
})
