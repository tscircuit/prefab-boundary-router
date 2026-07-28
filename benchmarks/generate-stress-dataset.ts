import { generateStressDataset } from "./stress-dataset"

const outputPath = new URL(
  "./datasets/random-boundary-problems.json",
  import.meta.url,
)
const dataset = generateStressDataset()

await Bun.write(outputPath, `${JSON.stringify(dataset, null, 2)}\n`)
console.log(`Wrote ${dataset.cases.length} cases to ${outputPath.pathname}`)
