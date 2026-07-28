import { describe, expect, test } from "bun:test"
import type { BoundaryRoutingProblem } from "../lib"
import { prepareBoundaryRoutingProblem } from "../lib"

describe("input validation", () => {
  test("rejects non-reciprocal via mappings", () => {
    const problem: BoundaryRoutingProblem = {
      viaBoundary: {
        minX: 0,
        minY: 0,
        maxX: 10,
        maxY: 10,
        ports: [
          { portId: "v1", pairedPortId: "v2", x: 0, y: 5 },
          { portId: "v2", pairedPortId: "v3", x: 10, y: 5 },
          { portId: "v3", pairedPortId: "v2", x: 5, y: 10 },
        ],
      },
      breakoutBoundary: {
        minX: 2,
        minY: 2,
        maxX: 8,
        maxY: 8,
        ports: [],
      },
    }

    expect(() => prepareBoundaryRoutingProblem(problem)).toThrow(
      "Via pairing must be reciprocal",
    )
  })
})
