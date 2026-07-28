import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { BoundaryRoutingPipelineSolver } from "../lib"
import { eightBreakoutTwentyViaProblem } from "../tests/fixtures/eight-breakout-twenty-via-problem"

export default function EightBreakoutTwentyViaFixture() {
  return (
    <GenericSolverDebugger
      createSolver={() =>
        new BoundaryRoutingPipelineSolver(eightBreakoutTwentyViaProblem)
      }
      animationSpeed={40}
    />
  )
}
