import type { BoundaryRoutingProblem, Point, RectBounds, ViaPort } from "../lib"

export const STRESS_DATASET_SEED = 20_260_728
export const STRESS_VIA_COUNTS = [20, 40, 60, 80, 100] as const
export const STRESS_CASES_PER_VIA_COUNT = 4

export interface StressProblemCase {
  caseId: string
  seed: number
  viaCount: number
  breakoutPortCount: number
  netCount: number
  problem: BoundaryRoutingProblem
}

export interface StressProblemDataset {
  datasetId: string
  description: string
  seed: number
  cases: StressProblemCase[]
}

class SeededRandom {
  constructor(private state: number) {}

  next() {
    this.state |= 0
    this.state = (this.state + 0x6d2b79f5) | 0
    let value = this.state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }

  integer(minimum: number, maximum: number) {
    return Math.floor(this.next() * (maximum - minimum + 1)) + minimum
  }

  shuffle<T>(values: T[]) {
    for (let index = values.length - 1; index > 0; index--) {
      const target = this.integer(0, index)
      ;[values[index], values[target]] = [values[target]!, values[index]!]
    }
    return values
  }
}

const roundCoordinate = (value: number) => Math.round(value * 10_000) / 10_000

const getSideCounts = (count: number, random: SeededRandom) => {
  const counts = [
    Math.floor(count / 3),
    Math.floor(count / 3),
    Math.floor(count / 3),
  ]
  const sideOrder = random.shuffle([0, 1, 2])
  for (let remainder = count % 3; remainder > 0; remainder--) {
    counts[sideOrder[remainder - 1]!]!++
  }
  return counts
}

const createBoundaryPoints = (
  bounds: RectBounds,
  count: number,
  random: SeededRandom,
): Point[] => {
  const sideCounts = getSideCounts(count, random)
  const points: Point[] = []

  for (let side = 0; side < sideCounts.length; side++) {
    const sideCount = sideCounts[side]!
    for (let index = 0; index < sideCount; index++) {
      const evenFraction = (index + 1) / (sideCount + 1)
      const jitter = ((random.next() - 0.5) * 0.5) / (sideCount + 1)
      const fraction = Math.min(0.98, Math.max(0.02, evenFraction + jitter))
      if (side === 0) {
        points.push({
          x: roundCoordinate(
            bounds.minX + fraction * (bounds.maxX - bounds.minX),
          ),
          y: bounds.minY,
        })
      } else if (side === 1) {
        points.push({
          x: bounds.maxX,
          y: roundCoordinate(
            bounds.minY + fraction * (bounds.maxY - bounds.minY),
          ),
        })
      } else {
        points.push({
          x: roundCoordinate(
            bounds.maxX - fraction * (bounds.maxX - bounds.minX),
          ),
          y: bounds.maxY,
        })
      }
    }
  }

  return points
}

const createProblem = (
  caseId: string,
  viaCount: number,
  seed: number,
): StressProblemCase => {
  const random = new SeededRandom(seed)
  const width = roundCoordinate(90 + random.next() * 20)
  const height = roundCoordinate(60 + random.next() * 20)
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

  const viaPoints = createBoundaryPoints(viaBoundary, viaCount, random)
  const shuffledViaIndexes = random.shuffle(
    Array.from({ length: viaCount }, (_, index) => index),
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

  const breakoutPortCount = Math.round(viaCount * 0.4)
  const netCount = breakoutPortCount / 2
  const breakoutPoints = createBoundaryPoints(
    breakoutBoundary,
    breakoutPortCount,
    random,
  )
  const shuffledBreakoutIndexes = random.shuffle(
    Array.from({ length: breakoutPoints.length }, (_, index) => index),
  )
  const netIndexByPortIndex = new Map<number, number>()
  for (let netIndex = 0; netIndex < netCount; netIndex++) {
    netIndexByPortIndex.set(shuffledBreakoutIndexes[netIndex * 2]!, netIndex)
    netIndexByPortIndex.set(
      shuffledBreakoutIndexes[netIndex * 2 + 1]!,
      netIndex,
    )
  }

  return {
    caseId,
    seed,
    viaCount,
    breakoutPortCount,
    netCount,
    problem: {
      viaBoundary: { ...viaBoundary, ports: viaPorts },
      breakoutBoundary: {
        ...breakoutBoundary,
        ports: breakoutPoints.map((point, index) => ({
          portId: `${caseId}-breakout-port-${index}`,
          netId: `${caseId}-net-${netIndexByPortIndex.get(index)!}`,
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

export const generateStressDataset = (): StressProblemDataset => {
  const masterRandom = new SeededRandom(STRESS_DATASET_SEED)
  const cases = STRESS_VIA_COUNTS.flatMap((viaCount) =>
    Array.from({ length: STRESS_CASES_PER_VIA_COUNT }, (_, caseIndex) => {
      const caseId = `random-v${viaCount}-c${caseIndex + 1}`
      return createProblem(
        caseId,
        viaCount,
        masterRandom.integer(1, 2 ** 31 - 1),
      )
    }),
  )

  return {
    datasetId: "random-boundary-problems-v2",
    description:
      "Deterministic random vector-routing problems whose via and breakout port counts both scale across the top, right, and bottom boundaries.",
    seed: STRESS_DATASET_SEED,
    cases,
  }
}
