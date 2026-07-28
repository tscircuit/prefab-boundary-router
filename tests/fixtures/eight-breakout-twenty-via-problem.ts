import type { BoundaryRoutingProblem, Point, ViaPort } from "../../lib"

const viaLocations: Point[] = [
  { x: 2, y: 0 },
  { x: 4, y: 0 },
  { x: 6, y: 0 },
  { x: 8, y: 0 },
  { x: 12, y: 0 },
  { x: 14, y: 0 },
  { x: 16, y: 0 },
  { x: 18, y: 0 },
  { x: 20, y: 2 },
  { x: 20, y: 5 },
  { x: 20, y: 9 },
  { x: 20, y: 12 },
  { x: 18, y: 14 },
  { x: 16, y: 14 },
  { x: 14, y: 14 },
  { x: 12, y: 14 },
  { x: 8, y: 14 },
  { x: 6, y: 14 },
  { x: 4, y: 14 },
  { x: 2, y: 14 },
]

const viaPorts: ViaPort[] = viaLocations.map((point, index) => ({
  id: `via-${index}`,
  pairedPortId: `via-${(index + 10) % viaLocations.length}`,
  ...point,
}))

export const eightBreakoutTwentyViaProblem: BoundaryRoutingProblem = {
  viaBoundary: {
    minX: 0,
    minY: 0,
    maxX: 20,
    maxY: 14,
    ports: viaPorts,
  },
  breakoutBoundary: {
    minX: 6,
    minY: 4,
    maxX: 14,
    maxY: 10,
    ports: [
      { id: "top-left", netId: "A", x: 7, y: 4 },
      { id: "top-center", netId: "B", x: 10, y: 4 },
      { id: "top-right", netId: "C", x: 13, y: 4 },
      { id: "right-top", netId: "D", x: 14, y: 6 },
      { id: "right-bottom", netId: "D", x: 14, y: 8 },
      { id: "bottom-right", netId: "A", x: 13, y: 10 },
      { id: "bottom-center", netId: "B", x: 10, y: 10 },
      { id: "bottom-left", netId: "C", x: 7, y: 10 },
    ],
  },
  options: {
    viaJumpCost: 0.25,
    ripCost: 2,
    historyIncrement: 4,
    expansionsPerStep: 50,
  },
}
