import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { BoundaryRoutingPipelineSolver } from "../lib"
import { demoProblem } from "../tests/fixtures/demo-problem"

export default function DemoFixture() {
  return (
    <GenericSolverDebugger
      createSolver={() => new BoundaryRoutingPipelineSolver(demoProblem)}
      animationSpeed={40}
    />
  )
}
