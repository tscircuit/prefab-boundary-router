import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { BoundaryRoutingPipelineSolver } from "../lib"
import { clad1SevenNetProblem } from "../tests/fixtures/clad1-seven-net-problem"

export default function Clad1SevenNetFixture() {
  return (
    <GenericSolverDebugger
      createSolver={() =>
        new BoundaryRoutingPipelineSolver(clad1SevenNetProblem)
      }
      animationSpeed={40}
    />
  )
}
