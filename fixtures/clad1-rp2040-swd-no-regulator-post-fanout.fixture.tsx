import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import {
  BoundaryRoutingPipelineSolver,
  type BoundaryRoutingProblem,
} from "../lib"
import postFanoutProblemJson from "../tests/fixtures/clad1-rp2040-swd-no-regulator-post-fanout.json"

const postFanoutProblem =
  postFanoutProblemJson as unknown as BoundaryRoutingProblem

export default function Clad1Rp2040SwdNoRegulatorPostFanoutFixture() {
  return (
    <GenericSolverDebugger
      createSolver={() => new BoundaryRoutingPipelineSolver(postFanoutProblem)}
      animationSpeed={80}
    />
  )
}
