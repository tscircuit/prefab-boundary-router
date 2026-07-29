import type { BoundaryRoutingProblem } from "../../lib"

const viaPairs = [
  ["top:r0:2", "top:r0:5"],
  ["top:r1:5", "right:r1:6"],
  ["bottom:r1:7", "bottom:r0:4"],
  ["bottom:r0:15", "bottom:r1:13"],
  ["top:r1:6", "top:r0:0"],
  ["top:r0:9", "top:r1:13"],
  ["bottom:r1:9", "bottom:r0:10"],
  ["bottom:r1:3", "right:r0:1"],
  ["right:r1:4", "right:r1:3"],
  ["right:r0:7", "top:r0:16"],
  ["top:r1:12", "top:r0:1"],
  ["bottom:r0:13", "bottom:r0:14"],
  ["right:r1:2", "right:r0:5"],
  ["top:r1:4", "top:r1:8"],
  ["bottom:r0:11", "bottom:r1:14"],
  ["top:r1:1", "top:r1:0"],
  ["bottom:r0:7", "bottom:r1:11"],
  ["bottom:r1:5", "bottom:r0:1"],
  ["right:r0:4", "right:r0:2"],
  ["top:r0:15", "top:r0:14"],
  ["right:r1:5", "top:r0:12"],
  ["right:r0:3", "right:r1:1"],
  ["right:r0:6", "bottom:r0:16"],
  ["top:r0:11", "top:r1:14"],
  ["top:r1:3", "top:r1:2"],
  ["bottom:r0:9", "bottom:r1:4"],
  ["top:r1:9", "top:r0:4"],
  ["top:r1:11", "top:r1:10"],
  ["bottom:r0:6", "bottom:r0:8"],
  ["bottom:r1:8", "right:r1:0"],
  ["bottom:r1:6", "bottom:r0:2"],
  ["bottom:r1:2", "bottom:r0:0"],
  ["top:r0:13", "right:r0:8"],
  ["right:r0:0", "bottom:r0:12"],
  ["bottom:r1:1", "bottom:r0:5"],
  ["bottom:r0:3", "bottom:r1:0"],
  ["top:r0:8", "top:r0:10"],
  ["top:r1:7", "top:r0:3"],
  ["top:r0:7", "top:r0:6"],
  ["bottom:r1:10", "bottom:r1:12"],
] as const

const viaPoint = (portId: string) => {
  const [side, row, indexString] = portId.split(":")
  const rowNumber = Number(row!.slice(1))
  const index = Number(indexString!)
  if (side === "right") {
    return { x: 40, y: -20 + index * 5 + (rowNumber === 0 ? -0.2 : 0.2) }
  }
  const x = (rowNumber === 0 ? -40 : -37.5) + index * 5
  return { x, y: side === "top" ? 25 : -25 }
}

const breakoutPortDefinitions: [string, string, number, number][] = [
  ["57:0", "161", -17.4, -15],
  ["57:1", "161", -18.8, -15],
  ["66:0", "337", 4.8, 15],
  ["66:1", "337", 3.6, 15],
  ["79:0", "333", -3.4, -15],
  ["79:1", "333", -8.4, 15],
  ["80:0", "212", -5.6, -15],
  ["80:1", "212", -10.8, 15],
  ["81:0", "215", -5.2, -15],
  ["81:1", "215", -9.2, 15],
  ["82:0", "218", -5.4, -15],
  ["82:1", "218", -9.8, 15],
  ["83:0", "221", -7, -15],
  ["83:1", "221", -7.8, 15],
  ["133:0", "333", -23.4, 15],
  ["135:0", "333", -13.8, 15],
  ["137:0", "337", 13.8, 15],
]

export const clad1SevenNetReproProblem: BoundaryRoutingProblem = {
  breakoutBoundary: {
    minX: -50,
    maxX: 28,
    minY: -15,
    maxY: 15,
    ports: breakoutPortDefinitions.map(([id, netId, x, y]) => ({
      portId: `fanout:${id}`,
      netId,
      x,
      y,
    })),
  },
  viaBoundary: {
    minX: -50.1,
    maxX: 40,
    minY: -25,
    maxY: 25,
    ports: viaPairs.flatMap(([first, second]) => [
      { portId: first, pairedPortId: second, ...viaPoint(first) },
      { portId: second, pairedPortId: first, ...viaPoint(second) },
    ]),
  },
  options: {
    ripCost: 60,
    maxBlockersPerSearch: 16,
    maxRipsPerRoute: 24,
    maxTotalRips: 300,
  },
}
