import {
  BasePipelineSolver,
  definePipelineStep,
  type PipelineStep,
} from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { visualizeProblem } from "./geometry"
import { PrepareBoundaryRoutingProblemSolver } from "./prepare-boundary-routing-problem-solver"
import { RipUpAStarBoundarySolver } from "./rip-up-a-star-boundary-solver"
import type {
  BoundaryRoutingProblem,
  BoundaryRoutingSolution,
  PreparedBoundaryRoutingProblem,
} from "./types"

export class BoundaryRoutingPipelineSolver extends BasePipelineSolver<BoundaryRoutingProblem> {
  prepare?: PrepareBoundaryRoutingProblemSolver
  route?: RipUpAStarBoundarySolver

  override pipelineDef: PipelineStep<any>[] = [
    definePipelineStep(
      "prepare",
      PrepareBoundaryRoutingProblemSolver,
      (instance: BoundaryRoutingPipelineSolver) => [instance.inputProblem],
    ),
    definePipelineStep(
      "route",
      RipUpAStarBoundarySolver,
      (instance: BoundaryRoutingPipelineSolver) => {
        const prepared =
          instance.getStageOutput<PreparedBoundaryRoutingProblem>("prepare")
        if (!prepared) {
          throw new Error("prepare stage did not produce a routing problem")
        }
        return [prepared]
      },
    ),
  ]

  constructor(problem: BoundaryRoutingProblem) {
    super(problem)
    this.MAX_ITERATIONS = 2_000_000
  }

  override getConstructorParams(): [BoundaryRoutingProblem] {
    return [this.inputProblem]
  }

  get stage() {
    return this.getCurrentStageName()
  }

  get routingSolver() {
    return this.getSolver<RipUpAStarBoundarySolver>("route") ?? null
  }

  override initialVisualize(): GraphicsObject {
    return visualizeProblem(this.inputProblem)
  }

  override finalVisualize(): GraphicsObject | null {
    return this.routingSolver?.visualize() ?? null
  }

  override visualize(): GraphicsObject {
    if (this.solved && this.routingSolver) {
      return this.routingSolver.visualize()
    }
    return super.visualize()
  }

  override getOutput(): BoundaryRoutingSolution | null {
    return (
      this.getStageOutput<BoundaryRoutingSolution>("route") ??
      this.routingSolver?.getOutput() ??
      null
    )
  }
}
