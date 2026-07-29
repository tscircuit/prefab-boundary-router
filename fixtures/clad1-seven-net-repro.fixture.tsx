import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { BoundaryRoutingPipelineSolver } from "../lib"
import { clad1SevenNetReproProblem } from "../tests/fixtures/clad1-seven-net-repro-problem"

export default function Clad1SevenNetReproFixture() {
  return (
    <GenericSolverDebugger
      createSolver={() =>
        new BoundaryRoutingPipelineSolver(clad1SevenNetReproProblem)
      }
      animationSpeed={80}
    />
  )
}
