import { expect, test } from "bun:test"
import {
  getHighDensityRoutingWindow,
  prepareBoundaryRoutingProblem,
} from "../lib"
import { demoProblem } from "./fixtures/demo-problem"

test("highDensityRoutingMargin expands only the needed B01 area", () => {
  const window = getHighDensityRoutingWindow(
    { x: 2, y: 5 },
    { x: 0, y: 5 },
    demoProblem.viaBoundary,
    1.25,
  )

  expect(window).toEqual({
    minX: 0,
    minY: 3.75,
    maxX: 3.25,
    maxY: 6.25,
  })
  expect(window.maxX - window.minX).toBeLessThanOrEqual(15)
  expect(window.maxY - window.minY).toBeLessThanOrEqual(15)
})

test("highDensityRoutingMargin is configurable and validated", () => {
  const prepared = prepareBoundaryRoutingProblem({
    ...demoProblem,
    options: { highDensityRoutingMargin: 0.75 },
  })
  expect(prepared.options.highDensityRoutingMargin).toBe(0.75)

  expect(() =>
    prepareBoundaryRoutingProblem({
      ...demoProblem,
      options: { highDensityRoutingMargin: -1 },
    }),
  ).toThrow("options.highDensityRoutingMargin must be non-negative")
})
