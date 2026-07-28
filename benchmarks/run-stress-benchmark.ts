import { BoundaryRoutingPipelineSolver } from "../lib"
import type { StressProblemCase, StressProblemDataset } from "./stress-dataset"

interface CaseBenchmarkResult {
  caseId: string
  viaCount: number
  breakoutPortCount: number
  netCount: number
  solved: boolean
  durationMs: number
  ripCount: number | null
  expandedStateCount: number | null
  error: string | null
}

interface BenchmarkSummary {
  caseCount: number
  solvedCount: number
  solvePercent: number
  attemptTimeP50Ms: number
  attemptTimeP95Ms: number
  solvedTimeP50Ms: number | null
  solvedTimeP95Ms: number | null
}

interface BenchmarkDataset extends StressProblemDataset {
  minimumSolvePercent?: number
}

const roundMetric = (value: number) => Math.round(value * 100) / 100

const percentile = (values: number[], probability: number) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const rank = (sorted.length - 1) * probability
  const lowerIndex = Math.floor(rank)
  const upperIndex = Math.ceil(rank)
  const lower = sorted[lowerIndex]!
  const upper = sorted[upperIndex]!
  return roundMetric(lower + (upper - lower) * (rank - lowerIndex))
}

const summarize = (results: CaseBenchmarkResult[]): BenchmarkSummary => {
  const solvedResults = results.filter((result) => result.solved)
  const attemptTimes = results.map((result) => result.durationMs)
  const solvedTimes = solvedResults.map((result) => result.durationMs)
  return {
    caseCount: results.length,
    solvedCount: solvedResults.length,
    solvePercent: roundMetric((solvedResults.length / results.length) * 100),
    attemptTimeP50Ms: percentile(attemptTimes, 0.5)!,
    attemptTimeP95Ms: percentile(attemptTimes, 0.95)!,
    solvedTimeP50Ms: percentile(solvedTimes, 0.5),
    solvedTimeP95Ms: percentile(solvedTimes, 0.95),
  }
}

const benchmarkCase = (problemCase: StressProblemCase): CaseBenchmarkResult => {
  const startedAt = performance.now()
  const solver = new BoundaryRoutingPipelineSolver(problemCase.problem)
  let thrownError: unknown = null
  try {
    solver.solve()
  } catch (error) {
    thrownError = error
  }
  const durationMs = roundMetric(performance.now() - startedAt)
  const output = solver.getOutput()
  const error =
    thrownError instanceof Error
      ? thrownError.message
      : thrownError
        ? String(thrownError)
        : solver.error

  return {
    caseId: problemCase.caseId,
    viaCount: problemCase.viaCount,
    breakoutPortCount: problemCase.breakoutPortCount,
    netCount: problemCase.netCount,
    solved: solver.solved && !solver.failed,
    durationMs,
    ripCount: output?.stats.ripCount ?? null,
    expandedStateCount: output?.stats.expandedStateCount ?? null,
    error: error || null,
  }
}

const formatMetric = (value: number | null) =>
  value === null ? "n/a" : value.toFixed(2)

const createMarkdownReport = (
  dataset: BenchmarkDataset,
  reportTitle: string,
  generatedAt: string,
  overall: BenchmarkSummary,
  byViaCount: Record<string, BenchmarkSummary>,
) => {
  const breakoutPortCounts = dataset.cases.map(
    (problemCase) => problemCase.breakoutPortCount,
  )
  const minimumBreakoutPortCount = Math.min(...breakoutPortCounts)
  const maximumBreakoutPortCount = Math.max(...breakoutPortCounts)
  const breakoutPortRange =
    minimumBreakoutPortCount === maximumBreakoutPortCount
      ? String(minimumBreakoutPortCount)
      : `${minimumBreakoutPortCount}–${maximumBreakoutPortCount}`
  const rows = Object.entries(byViaCount)
    .map(([viaCount, summary]) => {
      const breakoutPortCount = dataset.cases.find(
        (problemCase) => problemCase.viaCount === Number(viaCount),
      )!.breakoutPortCount
      return `| ${viaCount} | ${breakoutPortCount} | ${summary.solvedCount}/${summary.caseCount} (${summary.solvePercent.toFixed(2)}%) | ${formatMetric(summary.solvedTimeP50Ms)} | ${formatMetric(summary.solvedTimeP95Ms)} | ${summary.attemptTimeP50Ms.toFixed(2)} | ${summary.attemptTimeP95Ms.toFixed(2)} |`
    })
    .join("\n")

  return `# ${reportTitle}

- Dataset: \`${dataset.datasetId}\`
- Seed: \`${dataset.seed}\`
- Generated: ${generatedAt}
- Runtime: Bun ${Bun.version} on ${process.platform}/${process.arch}
- Percentile method: linear interpolation
${dataset.minimumSolvePercent === undefined ? "" : `- Minimum solve target: ${dataset.minimumSolvePercent}%`}

Successful-solve percentiles include solved cases only. Attempt percentiles include
both solved and failed cases, measuring the wall-clock cost of every attempt.

| Via ports | Breakout ports | Solved | Solved p50 (ms) | Solved p95 (ms) | Attempt p50 (ms) | Attempt p95 (ms) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows}
| **Overall** | **${breakoutPortRange}** | **${overall.solvedCount}/${overall.caseCount} (${overall.solvePercent.toFixed(2)}%)** | **${formatMetric(overall.solvedTimeP50Ms)}** | **${formatMetric(overall.solvedTimeP95Ms)}** | **${overall.attemptTimeP50Ms.toFixed(2)}** | **${overall.attemptTimeP95Ms.toFixed(2)}** |
`
}

const benchmarkConfigurations = {
  "size-sweep": {
    datasetPath: "./datasets/random-boundary-problems.json",
    jsonOutputPath: "./results/latest.json",
    markdownOutputPath: "./results/latest.md",
    reportTitle: "Random boundary stress benchmark",
  },
  production: {
    datasetPath: "./datasets/production-boundary-problems.json",
    jsonOutputPath: "./results/production-latest.json",
    markdownOutputPath: "./results/production-latest.md",
    reportTitle: "Production-shaped boundary stress benchmark",
  },
} as const
const requestedBenchmark = process.argv[2] ?? "size-sweep"
if (!(requestedBenchmark in benchmarkConfigurations)) {
  throw new Error(
    `Unknown benchmark "${requestedBenchmark}". Expected one of: ${Object.keys(benchmarkConfigurations).join(", ")}`,
  )
}
const configuration =
  benchmarkConfigurations[
    requestedBenchmark as keyof typeof benchmarkConfigurations
  ]
const datasetPath = new URL(configuration.datasetPath, import.meta.url)
const dataset = (await Bun.file(datasetPath).json()) as BenchmarkDataset

benchmarkCase(dataset.cases[0]!)

const results: CaseBenchmarkResult[] = []
for (const [index, problemCase] of dataset.cases.entries()) {
  const result = benchmarkCase(problemCase)
  results.push(result)
  console.log(
    `[${index + 1}/${dataset.cases.length}] ${result.caseId}: ${result.solved ? "solved" : "failed"} in ${result.durationMs.toFixed(2)}ms`,
  )
}

const overall = summarize(results)
const byViaCount = Object.fromEntries(
  [...new Set(results.map((result) => result.viaCount))]
    .sort((left, right) => left - right)
    .map((viaCount) => [
      String(viaCount),
      summarize(results.filter((result) => result.viaCount === viaCount)),
    ]),
)
const generatedAt = new Date().toISOString()
const report = {
  datasetId: dataset.datasetId,
  datasetSeed: dataset.seed,
  generatedAt,
  runtime: {
    bun: Bun.version,
    platform: process.platform,
    architecture: process.arch,
  },
  percentileMethod: "linear interpolation",
  minimumSolvePercent: dataset.minimumSolvePercent ?? null,
  overall,
  byViaCount,
  results,
}
const jsonOutputPath = new URL(configuration.jsonOutputPath, import.meta.url)
const markdownOutputPath = new URL(
  configuration.markdownOutputPath,
  import.meta.url,
)

await Promise.all([
  Bun.write(jsonOutputPath, `${JSON.stringify(report, null, 2)}\n`),
  Bun.write(
    markdownOutputPath,
    createMarkdownReport(
      dataset,
      configuration.reportTitle,
      generatedAt,
      overall,
      byViaCount,
    ),
  ),
])

console.log(
  `Overall: ${overall.solvedCount}/${overall.caseCount} solved (${overall.solvePercent.toFixed(2)}%); successful solve p50/p95 ${
    overall.solvedTimeP50Ms === null || overall.solvedTimeP95Ms === null
      ? "n/a"
      : `${overall.solvedTimeP50Ms.toFixed(2)}/${overall.solvedTimeP95Ms.toFixed(2)}ms`
  }; attempt p50/p95 ${overall.attemptTimeP50Ms.toFixed(2)}/${overall.attemptTimeP95Ms.toFixed(2)}ms`,
)
if (
  dataset.minimumSolvePercent !== undefined &&
  overall.solvePercent < dataset.minimumSolvePercent
) {
  console.error(
    `Benchmark failed: ${overall.solvePercent.toFixed(2)}% solved is below the ${dataset.minimumSolvePercent.toFixed(2)}% target`,
  )
  process.exitCode = 1
}
