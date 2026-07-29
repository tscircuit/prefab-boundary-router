import { generateDoubleBreakoutProductionStressDataset } from "./production-stress-dataset"

const outputPath = new URL(
  "./datasets/production-double-breakout-boundary-problems.json",
  import.meta.url,
)
const dataset = generateDoubleBreakoutProductionStressDataset()

await Bun.write(outputPath, `${JSON.stringify(dataset, null, 2)}\n`)
console.log(`Wrote ${dataset.cases.length} cases to ${outputPath.pathname}`)
