import type { BoundaryRoutingProblem } from "../../lib"

export const demoProblem: BoundaryRoutingProblem = {
  viaBoundary: {
    minX: 0,
    minY: 0,
    maxX: 10,
    maxY: 10,
    ports: [
      { id: "via-left", pairedPortId: "via-right", x: 0, y: 5 },
      { id: "via-right", pairedPortId: "via-left", x: 10, y: 5 },
      { id: "via-top-left", pairedPortId: "via-top-right", x: 1, y: 0 },
      { id: "via-top-right", pairedPortId: "via-top-left", x: 9, y: 0 },
    ],
  },
  breakoutBoundary: {
    minX: 2,
    minY: 2,
    maxX: 8,
    maxY: 8,
    ports: [
      { id: "a-left", netId: "A", x: 2, y: 4 },
      { id: "a-right", netId: "A", x: 8, y: 4 },
      { id: "b-left", netId: "B", x: 2, y: 6 },
      { id: "b-right", netId: "B", x: 8, y: 6 },
    ],
  },
  options: {
    viaJumpCost: 0.25,
    ripCost: 0.1,
    crossingCost: 0.05,
    historyIncrement: 4,
    expansionsPerStep: 25,
  },
}
