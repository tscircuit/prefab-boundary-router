import type { BreakoutPort, Point, RectBounds, ViaPort } from "../lib"
import {
  createBoundaryPoints,
  roundCoordinate,
  SeededRandom,
  type StressProblemCase,
  type StressProblemDataset,
} from "./stress-dataset"

export const PRODUCTION_DATASET_SEED = 20_260_729
export const PRODUCTION_SAMPLE_COUNT = 20
export const PRODUCTION_VIA_COUNT = 80
export const PRODUCTION_BREAKOUT_PORT_COUNT = 120
export const PRODUCTION_NET_COUNT = 80
export const POWER_NET_PORT_COUNT = 12
export const SIGNAL_NET_COUNT = PRODUCTION_NET_COUNT - 2
export const TWO_PORT_SIGNAL_NET_COUNT =
  PRODUCTION_BREAKOUT_PORT_COUNT - POWER_NET_PORT_COUNT * 2 - SIGNAL_NET_COUNT
export const SINGLE_PORT_SIGNAL_NET_COUNT =
  SIGNAL_NET_COUNT - TWO_PORT_SIGNAL_NET_COUNT
export const PRODUCTION_ROUTE_DEMAND_COUNT =
  (POWER_NET_PORT_COUNT - 1) * 2 + TWO_PORT_SIGNAL_NET_COUNT

export const DOUBLE_BREAKOUT_PRODUCTION_DATASET_SEED = 20_260_730
export const DOUBLE_BREAKOUT_PRODUCTION_SAMPLE_COUNT = 20
export const DOUBLE_BREAKOUT_PRODUCTION_VIA_COUNT = 80
export const DOUBLE_BREAKOUT_PRODUCTION_BREAKOUT_PORT_COUNT = 240
export const DOUBLE_BREAKOUT_PRODUCTION_NET_COUNT = 200
export const DOUBLE_BREAKOUT_POWER_NET_PORT_COUNT = 12
export const DOUBLE_BREAKOUT_SIGNAL_NET_COUNT =
  DOUBLE_BREAKOUT_PRODUCTION_NET_COUNT - 2
export const DOUBLE_BREAKOUT_TWO_PORT_SIGNAL_NET_COUNT =
  DOUBLE_BREAKOUT_PRODUCTION_BREAKOUT_PORT_COUNT -
  DOUBLE_BREAKOUT_POWER_NET_PORT_COUNT * 2 -
  DOUBLE_BREAKOUT_SIGNAL_NET_COUNT
export const DOUBLE_BREAKOUT_SINGLE_PORT_SIGNAL_NET_COUNT =
  DOUBLE_BREAKOUT_SIGNAL_NET_COUNT - DOUBLE_BREAKOUT_TWO_PORT_SIGNAL_NET_COUNT
export const DOUBLE_BREAKOUT_PRODUCTION_ROUTE_DEMAND_COUNT =
  (DOUBLE_BREAKOUT_POWER_NET_PORT_COUNT - 1) * 2 +
  DOUBLE_BREAKOUT_TWO_PORT_SIGNAL_NET_COUNT

interface ProductionStressProfile {
  caseIdPrefix: string
  datasetId: string
  description: string
  seed: number
  sampleCount: number
  viaCount: number
  breakoutPortCount: number
  netCount: number
  powerNetPortCount: number
  minimumSolvePercent: number
  maxRipsPerRoute: number
  maxTotalRips: number
  maxSearchStates: number
  hardenIdentifierOrdering?: boolean
}

const productionStressProfile: ProductionStressProfile = {
  caseIdPrefix: "production",
  datasetId: "production-boundary-problems-v2",
  description:
    "Deterministic known-feasible production-shaped boundary-routing problems with 120 breakout ports across 80 nets and 80 paired via ports.",
  seed: PRODUCTION_DATASET_SEED,
  sampleCount: PRODUCTION_SAMPLE_COUNT,
  viaCount: PRODUCTION_VIA_COUNT,
  breakoutPortCount: PRODUCTION_BREAKOUT_PORT_COUNT,
  netCount: PRODUCTION_NET_COUNT,
  powerNetPortCount: POWER_NET_PORT_COUNT,
  minimumSolvePercent: 100,
  maxRipsPerRoute: 24,
  maxTotalRips: 300,
  maxSearchStates: 20_000,
}

const doubleBreakoutProductionStressProfile: ProductionStressProfile = {
  caseIdPrefix: "production-double-breakout",
  datasetId: "production-double-breakout-boundary-problems-v1",
  description:
    "Deterministic known-feasible production-shaped boundary-routing problems with 240 breakout ports across 200 nets, 80 paired via ports, and identifier ordering decoupled from geometry.",
  seed: DOUBLE_BREAKOUT_PRODUCTION_DATASET_SEED,
  sampleCount: DOUBLE_BREAKOUT_PRODUCTION_SAMPLE_COUNT,
  viaCount: DOUBLE_BREAKOUT_PRODUCTION_VIA_COUNT,
  breakoutPortCount: DOUBLE_BREAKOUT_PRODUCTION_BREAKOUT_PORT_COUNT,
  netCount: DOUBLE_BREAKOUT_PRODUCTION_NET_COUNT,
  powerNetPortCount: DOUBLE_BREAKOUT_POWER_NET_PORT_COUNT,
  minimumSolvePercent: 75,
  maxRipsPerRoute: 24,
  maxTotalRips: 300,
  maxSearchStates: 20_000,
  hardenIdentifierOrdering: true,
}

export interface KnownRoutePlanConnection {
  netId: string
  sourcePortId: string
  targetPortId: string
  entryViaPortId: string
  exitViaPortId: string
}

export interface ProductionStressProblemCase extends StressProblemCase {
  powerNetPortCounts: {
    VCC: number
    GND: number
  }
  twoPortSignalNetCount: number
  knownRoutePlan: KnownRoutePlanConnection[]
}

export interface ProductionStressProblemDataset
  extends Omit<StressProblemDataset, "cases"> {
  minimumSolvePercent: number
  profile: {
    viaCount: number
    breakoutPortCount: number
    netCount: number
    powerNetPortCounts: {
      VCC: number
      GND: number
    }
    twoPortSignalNetCount: number
    singlePortSignalNetCount: number
  }
  cases: ProductionStressProblemCase[]
}

interface PlannedConnection {
  netId: string
  sourcePort: BreakoutPort
  targetPort: BreakoutPort
}

type SupportedBoundarySide = "top" | "right" | "bottom"

const getBoundarySide = (
  point: Point,
  bounds: RectBounds,
): SupportedBoundarySide => {
  if (point.y === bounds.minY) return "top"
  if (point.x === bounds.maxX) return "right"
  if (point.y === bounds.maxY) return "bottom"
  throw new Error("Production dataset only supports top, right, and bottom")
}

const getBoundaryPosition = (
  point: Point,
  bounds: RectBounds,
  side: SupportedBoundarySide,
) => {
  if (side === "top") return point.x - bounds.minX
  if (side === "right") return point.y - bounds.minY
  return bounds.maxX - point.x
}

const createPlannedConnections = (
  breakoutPorts: BreakoutPort[],
): PlannedConnection[] => {
  const portsByNet = new Map<string, BreakoutPort[]>()
  for (const port of breakoutPorts) {
    const netPorts = portsByNet.get(port.netId) ?? []
    netPorts.push(port)
    portsByNet.set(port.netId, netPorts)
  }

  const connections: PlannedConnection[] = []
  for (const [netId, unsortedPorts] of [...portsByNet].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const ports = [...unsortedPorts].sort((left, right) =>
      left.portId.localeCompare(right.portId),
    )
    if (ports.length < 2) continue
    const rootPort = ports[0]!
    for (const targetPort of ports.slice(1)) {
      connections.push({
        netId,
        sourcePort: rootPort,
        targetPort,
      })
    }
  }
  return connections
}

interface ConnectionEndpoint {
  endpointKey: string
  connectionIndex: number
  port: BreakoutPort
}

const createViaPlan = (
  caseId: string,
  viaBoundary: RectBounds,
  breakoutBoundary: RectBounds,
  connections: PlannedConnection[],
  random: SeededRandom,
) => {
  const endpoints: ConnectionEndpoint[] = connections.flatMap(
    (connection, connectionIndex) => [
      {
        endpointKey: `${connectionIndex}:source`,
        connectionIndex,
        port: connection.sourcePort,
      },
      {
        endpointKey: `${connectionIndex}:target`,
        connectionIndex,
        port: connection.targetPort,
      },
    ],
  )
  const viaPointByEndpointKey = new Map<string, Point>()
  const viaPortIdByEndpointKey = new Map<string, string>()
  let viaIndex = 0

  for (const side of ["top", "right", "bottom"] as const) {
    const sideEndpoints = endpoints
      .filter(({ port }) => getBoundarySide(port, breakoutBoundary) === side)
      .sort(
        (left, right) =>
          getBoundaryPosition(left.port, breakoutBoundary, side) -
            getBoundaryPosition(right.port, breakoutBoundary, side) ||
          left.connectionIndex - right.connectionIndex ||
          left.endpointKey.localeCompare(right.endpointKey),
      )

    for (const [sideIndex, endpoint] of sideEndpoints.entries()) {
      const evenFraction = (sideIndex + 1) / (sideEndpoints.length + 1)
      const jitter = ((random.next() - 0.5) * 0.4) / (sideEndpoints.length + 1)
      const fraction = evenFraction + jitter
      const point =
        side === "top"
          ? {
              x: roundCoordinate(
                breakoutBoundary.minX +
                  fraction * (breakoutBoundary.maxX - breakoutBoundary.minX),
              ),
              y: viaBoundary.minY,
            }
          : side === "right"
            ? {
                x: viaBoundary.maxX,
                y: roundCoordinate(
                  breakoutBoundary.minY +
                    fraction * (breakoutBoundary.maxY - breakoutBoundary.minY),
                ),
              }
            : {
                x: roundCoordinate(
                  breakoutBoundary.maxX -
                    fraction * (breakoutBoundary.maxX - breakoutBoundary.minX),
                ),
                y: viaBoundary.maxY,
              }
      viaPointByEndpointKey.set(endpoint.endpointKey, point)
      viaPortIdByEndpointKey.set(
        endpoint.endpointKey,
        `${caseId}-via-port-${viaIndex++}`,
      )
    }
  }

  const pairedEndpointKey = new Map<string, string>()
  for (
    let connectionIndex = 0;
    connectionIndex < connections.length;
    connectionIndex++
  ) {
    pairedEndpointKey.set(
      `${connectionIndex}:source`,
      `${connectionIndex}:target`,
    )
    pairedEndpointKey.set(
      `${connectionIndex}:target`,
      `${connectionIndex}:source`,
    )
  }

  const viaPorts: ViaPort[] = endpoints.map(({ endpointKey }) => ({
    portId: viaPortIdByEndpointKey.get(endpointKey)!,
    pairedPortId: viaPortIdByEndpointKey.get(
      pairedEndpointKey.get(endpointKey)!,
    )!,
    ...viaPointByEndpointKey.get(endpointKey)!,
  }))
  const knownRoutePlan: KnownRoutePlanConnection[] = connections.map(
    (connection, connectionIndex) => ({
      netId: connection.netId,
      sourcePortId: connection.sourcePort.portId,
      targetPortId: connection.targetPort.portId,
      entryViaPortId: viaPortIdByEndpointKey.get(`${connectionIndex}:source`)!,
      exitViaPortId: viaPortIdByEndpointKey.get(`${connectionIndex}:target`)!,
    }),
  )

  return { viaPorts, knownRoutePlan }
}

const createProductionProblem = (
  caseId: string,
  seed: number,
  profile: ProductionStressProfile,
): ProductionStressProblemCase => {
  const random = new SeededRandom(seed)
  const width = roundCoordinate(180 + random.next() * 40)
  const height = roundCoordinate(120 + random.next() * 40)
  const viaBoundary: RectBounds = {
    minX: 0,
    minY: 0,
    maxX: width,
    maxY: height,
  }
  const horizontalMargin = width * (0.22 + random.next() * 0.05)
  const verticalMargin = height * (0.24 + random.next() * 0.05)
  const breakoutBoundary: RectBounds = {
    minX: roundCoordinate(horizontalMargin),
    minY: roundCoordinate(verticalMargin),
    maxX: roundCoordinate(width - horizontalMargin),
    maxY: roundCoordinate(height - verticalMargin),
  }

  const signalNetCount = profile.netCount - 2
  const twoPortSignalNetCount =
    profile.breakoutPortCount - profile.powerNetPortCount * 2 - signalNetCount
  const signalNetIds = Array.from(
    { length: signalNetCount },
    (_, index) => `signal-net-${index + 1}`,
  )
  const duplicatedSignalNetIds = random
    .shuffle([...signalNetIds])
    .slice(0, twoPortSignalNetCount)
  const breakoutNetIds = random.shuffle([
    ...Array.from({ length: profile.powerNetPortCount }, () => "VCC"),
    ...Array.from({ length: profile.powerNetPortCount }, () => "GND"),
    ...signalNetIds,
    ...duplicatedSignalNetIds,
  ])
  const breakoutPoints = createBoundaryPoints(
    breakoutBoundary,
    profile.breakoutPortCount,
    random,
  )
  const breakoutPorts = breakoutPoints.map((point, index) => ({
    portId: `${caseId}-breakout-port-${index}`,
    netId: breakoutNetIds[index]!,
    ...point,
  }))
  const plannedConnections = createPlannedConnections(breakoutPorts)
  const { viaPorts, knownRoutePlan } = createViaPlan(
    caseId,
    viaBoundary,
    breakoutBoundary,
    plannedConnections,
    random,
  )

  return {
    caseId,
    seed,
    viaCount: profile.viaCount,
    breakoutPortCount: profile.breakoutPortCount,
    netCount: profile.netCount,
    powerNetPortCounts: {
      VCC: profile.powerNetPortCount,
      GND: profile.powerNetPortCount,
    },
    twoPortSignalNetCount,
    knownRoutePlan,
    problem: {
      viaBoundary: { ...viaBoundary, ports: viaPorts },
      breakoutBoundary: {
        ...breakoutBoundary,
        ports: breakoutPorts,
      },
      options: {
        viaJumpCost: 0.25,
        ripCost: 60,
        maxBlockersPerSearch: 4,
        maxRipsPerRoute: profile.maxRipsPerRoute,
        maxTotalRips: profile.maxTotalRips,
        maxSearchStates: profile.maxSearchStates,
        expansionsPerStep: 500,
      },
    },
  }
}

const hardenProductionProblemOrdering = (
  problemCase: ProductionStressProblemCase,
): ProductionStressProblemCase => {
  const random = new SeededRandom(problemCase.seed ^ 0x5eed2026)
  const netIds = [
    ...new Set(
      problemCase.problem.breakoutBoundary.ports.map((port) => port.netId),
    ),
  ].sort()
  const portIds = problemCase.problem.breakoutBoundary.ports
    .map((port) => port.portId)
    .sort()
  const shuffledNetIds = random.shuffle([...netIds])
  const shuffledPortIds = random.shuffle([...portIds])
  const netIdMap = new Map(
    shuffledNetIds.map((netId, index) => [
      netId,
      `hard-net-${String(index).padStart(3, "0")}`,
    ]),
  )
  const portIdMap = new Map(
    shuffledPortIds.map((portId, index) => [
      portId,
      `hard-port-${String(index).padStart(3, "0")}`,
    ]),
  )

  return {
    ...problemCase,
    problem: {
      ...problemCase.problem,
      breakoutBoundary: {
        ...problemCase.problem.breakoutBoundary,
        ports: problemCase.problem.breakoutBoundary.ports.map((port) => ({
          ...port,
          portId: portIdMap.get(port.portId)!,
          netId: netIdMap.get(port.netId)!,
        })),
      },
    },
    knownRoutePlan: problemCase.knownRoutePlan.map((connection) => ({
      ...connection,
      netId: netIdMap.get(connection.netId)!,
      sourcePortId: portIdMap.get(connection.sourcePortId)!,
      targetPortId: portIdMap.get(connection.targetPortId)!,
    })),
  }
}

const generateProductionStressDatasetForProfile = (
  profile: ProductionStressProfile,
): ProductionStressProblemDataset => {
  const masterRandom = new SeededRandom(profile.seed)
  const cases = Array.from(
    { length: profile.sampleCount },
    (_, sampleIndex) => {
      const problemCase = createProductionProblem(
        `${profile.caseIdPrefix}-c${String(sampleIndex + 1).padStart(2, "0")}`,
        masterRandom.integer(1, 2 ** 31 - 1),
        profile,
      )
      return profile.hardenIdentifierOrdering
        ? hardenProductionProblemOrdering(problemCase)
        : problemCase
    },
  )
  const signalNetCount = profile.netCount - 2
  const twoPortSignalNetCount =
    profile.breakoutPortCount - profile.powerNetPortCount * 2 - signalNetCount

  return {
    datasetId: profile.datasetId,
    description: profile.description,
    seed: profile.seed,
    minimumSolvePercent: profile.minimumSolvePercent,
    profile: {
      viaCount: profile.viaCount,
      breakoutPortCount: profile.breakoutPortCount,
      netCount: profile.netCount,
      powerNetPortCounts: {
        VCC: profile.powerNetPortCount,
        GND: profile.powerNetPortCount,
      },
      twoPortSignalNetCount,
      singlePortSignalNetCount: signalNetCount - twoPortSignalNetCount,
    },
    cases,
  }
}

export const generateProductionStressDataset =
  (): ProductionStressProblemDataset =>
    generateProductionStressDatasetForProfile(productionStressProfile)

export const generateDoubleBreakoutProductionStressDataset =
  (): ProductionStressProblemDataset =>
    generateProductionStressDatasetForProfile(
      doubleBreakoutProductionStressProfile,
    )
