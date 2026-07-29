import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { type CSSProperties, useEffect, useState } from "react"
import productionDatasetJson from "../benchmarks/datasets/production-boundary-problems.json"
import type { ProductionStressProblemDataset } from "../benchmarks/production-stress-dataset"
import productionBenchmarkJson from "../benchmarks/results/production-latest.json"
import { BoundaryRoutingPipelineSolver } from "../lib"

interface ProductionBenchmarkResult {
  caseId: string
  solved: boolean
  durationMs: number
  ripCount: number | null
  expandedStateCount: number | null
}

interface ProductionBenchmarkReport {
  overall: {
    solvePercent: number
    solvedTimeP50Ms: number | null
    solvedTimeP95Ms: number | null
  }
  results: ProductionBenchmarkResult[]
}

const dataset = productionDatasetJson as ProductionStressProblemDataset
const benchmark = productionBenchmarkJson as ProductionBenchmarkReport

const buttonStyle: CSSProperties = {
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  background: "#ffffff",
  color: "#0f172a",
  cursor: "pointer",
  font: "inherit",
  padding: "8px 12px",
}

const metric = (value: number | null) =>
  value === null ? "n/a" : `${value.toFixed(2)} ms`

export default function ProductionDatasetFixture() {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selectedSample = dataset.cases[selectedIndex]!
  const selectedResult = benchmark.results.find(
    (result) => result.caseId === selectedSample.caseId,
  )

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requestedIndex = dataset.cases.findIndex(
      (sample) => sample.caseId === params.get("sample"),
    )
    if (requestedIndex >= 0) setSelectedIndex(requestedIndex)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    params.set("sample", selectedSample.caseId)
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?${params.toString()}`,
    )
    document.title = `${selectedSample.caseId} · Prefab Boundary Router`
  }, [selectedSample.caseId])

  const selectSample = (index: number) => {
    if (index < 0 || index >= dataset.cases.length) return
    setSelectedIndex(index)
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        color: "#0f172a",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <header
        style={{
          borderBottom: "1px solid #e2e8f0",
          background: "#ffffff",
          display: "grid",
          gap: 12,
          padding: 16,
        }}
      >
        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            justifyContent: "space-between",
          }}
        >
          <div>
            <strong>Prefab Boundary Router · production corpus</strong>
            <div style={{ color: "#475569", fontSize: 13, marginTop: 4 }}>
              {selectedSample.caseId} · seed {selectedSample.seed} ·{" "}
              {selectedSample.breakoutPortCount} breakout ports ·{" "}
              {selectedSample.viaCount} via ports · {selectedSample.netCount}{" "}
              nets · {selectedSample.knownRoutePlan.length} route demands
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => selectSample(selectedIndex - 1)}
              disabled={selectedIndex === 0}
              style={{
                ...buttonStyle,
                cursor: selectedIndex === 0 ? "not-allowed" : "pointer",
                opacity: selectedIndex === 0 ? 0.45 : 1,
              }}
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => selectSample(selectedIndex + 1)}
              disabled={selectedIndex === dataset.cases.length - 1}
              style={{
                ...buttonStyle,
                cursor:
                  selectedIndex === dataset.cases.length - 1
                    ? "not-allowed"
                    : "pointer",
                opacity: selectedIndex === dataset.cases.length - 1 ? 0.45 : 1,
              }}
            >
              Next
            </button>
          </div>
        </div>

        <div style={{ color: "#475569", fontSize: 13 }}>
          {dataset.description} Latest benchmark:{" "}
          <strong>{benchmark.overall.solvePercent.toFixed(0)}% solved</strong> ·
          successful p50/p95 {metric(benchmark.overall.solvedTimeP50Ms)}/
          {metric(benchmark.overall.solvedTimeP95Ms)}.
        </div>

        <div
          aria-label="Production routing samples"
          role="tablist"
          style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
        >
          {dataset.cases.map((sample, index) => {
            const isSelected = index === selectedIndex
            const result = benchmark.results.find(
              (candidate) => candidate.caseId === sample.caseId,
            )
            return (
              <button
                aria-selected={isSelected}
                key={sample.caseId}
                onClick={() => selectSample(index)}
                role="tab"
                style={{
                  ...buttonStyle,
                  background: isSelected ? "#0f172a" : "#ffffff",
                  color: isSelected ? "#ffffff" : "#0f172a",
                }}
                type="button"
                title={
                  result
                    ? `${result.solved ? "Solved" : "Failed"} in ${result.durationMs.toFixed(2)} ms`
                    : sample.caseId
                }
              >
                C{String(index + 1).padStart(2, "0")} ·{" "}
                {result?.solved ? "✓" : "×"}
              </button>
            )
          })}
        </div>

        {selectedResult ? (
          <div style={{ color: "#475569", fontSize: 13 }}>
            Checked-in run:{" "}
            <strong>{selectedResult.solved ? "solved" : "failed"}</strong> in{" "}
            {selectedResult.durationMs.toFixed(2)} ms ·{" "}
            {selectedResult.ripCount ?? "n/a"} rips ·{" "}
            {selectedResult.expandedStateCount ?? "n/a"} expanded A* states.
          </div>
        ) : null}
      </header>

      <GenericSolverDebugger
        key={selectedSample.caseId}
        createSolver={() =>
          new BoundaryRoutingPipelineSolver(selectedSample.problem)
        }
        animationSpeed={80}
      />
    </div>
  )
}
