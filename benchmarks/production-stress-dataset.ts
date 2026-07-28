import type { RectBounds, ViaPort } from "../lib"
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

export interface ProductionStressProblemCase extends StressProblemCase {
  powerNetPortCounts: {
    VCC: number
    GND: number
  }
  twoPortSignalNetCount: number
}

export interface ProductionStressProblemDataset
  extends Omit<StressProblemDataset, "cases"> {
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

const createProductionProblem = (
  caseId: string,
  seed: number,
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

  const viaPoints = createBoundaryPoints(
    viaBoundary,
    PRODUCTION_VIA_COUNT,
    random,
  )
  const shuffledViaIndexes = random.shuffle(
    Array.from({ length: PRODUCTION_VIA_COUNT }, (_, index) => index),
  )
  const pairedIndexByIndex = new Map<number, number>()
  for (let index = 0; index < shuffledViaIndexes.length; index += 2) {
    const first = shuffledViaIndexes[index]!
    const second = shuffledViaIndexes[index + 1]!
    pairedIndexByIndex.set(first, second)
    pairedIndexByIndex.set(second, first)
  }
  const viaPorts: ViaPort[] = viaPoints.map((point, index) => ({
    portId: `${caseId}-via-port-${index}`,
    pairedPortId: `${caseId}-via-port-${pairedIndexByIndex.get(index)!}`,
    ...point,
  }))

  const signalNetIds = Array.from(
    { length: SIGNAL_NET_COUNT },
    (_, index) => `signal-net-${index + 1}`,
  )
  const duplicatedSignalNetIds = random
    .shuffle([...signalNetIds])
    .slice(0, TWO_PORT_SIGNAL_NET_COUNT)
  const breakoutNetIds = random.shuffle([
    ...Array.from({ length: POWER_NET_PORT_COUNT }, () => "VCC"),
    ...Array.from({ length: POWER_NET_PORT_COUNT }, () => "GND"),
    ...signalNetIds,
    ...duplicatedSignalNetIds,
  ])
  const breakoutPoints = createBoundaryPoints(
    breakoutBoundary,
    PRODUCTION_BREAKOUT_PORT_COUNT,
    random,
  )

  return {
    caseId,
    seed,
    viaCount: PRODUCTION_VIA_COUNT,
    breakoutPortCount: PRODUCTION_BREAKOUT_PORT_COUNT,
    netCount: PRODUCTION_NET_COUNT,
    powerNetPortCounts: {
      VCC: POWER_NET_PORT_COUNT,
      GND: POWER_NET_PORT_COUNT,
    },
    twoPortSignalNetCount: TWO_PORT_SIGNAL_NET_COUNT,
    problem: {
      viaBoundary: { ...viaBoundary, ports: viaPorts },
      breakoutBoundary: {
        ...breakoutBoundary,
        ports: breakoutPoints.map((point, index) => ({
          portId: `${caseId}-breakout-port-${index}`,
          netId: breakoutNetIds[index]!,
          ...point,
        })),
      },
      options: {
        viaJumpCost: 0.25,
        maxBlockersPerSearch: 4,
        maxRipsPerRoute: 8,
        maxTotalRips: 100,
        maxSearchStates: 20_000,
        expansionsPerStep: 500,
      },
    },
  }
}

export const generateProductionStressDataset =
  (): ProductionStressProblemDataset => {
    const masterRandom = new SeededRandom(PRODUCTION_DATASET_SEED)
    const cases = Array.from(
      { length: PRODUCTION_SAMPLE_COUNT },
      (_, sampleIndex) =>
        createProductionProblem(
          `production-c${String(sampleIndex + 1).padStart(2, "0")}`,
          masterRandom.integer(1, 2 ** 31 - 1),
        ),
    )

    return {
      datasetId: "production-boundary-problems-v1",
      description:
        "Deterministic production-shaped boundary-routing problems with 120 breakout ports across 80 nets and 80 paired via ports.",
      seed: PRODUCTION_DATASET_SEED,
      profile: {
        viaCount: PRODUCTION_VIA_COUNT,
        breakoutPortCount: PRODUCTION_BREAKOUT_PORT_COUNT,
        netCount: PRODUCTION_NET_COUNT,
        powerNetPortCounts: {
          VCC: POWER_NET_PORT_COUNT,
          GND: POWER_NET_PORT_COUNT,
        },
        twoPortSignalNetCount: TWO_PORT_SIGNAL_NET_COUNT,
        singlePortSignalNetCount: SINGLE_PORT_SIGNAL_NET_COUNT,
      },
      cases,
    }
  }
