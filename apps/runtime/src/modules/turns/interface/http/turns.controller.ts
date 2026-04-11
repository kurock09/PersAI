import { Body, Controller, Post } from "@nestjs/common";
import type { RuntimeTurnRequest, RuntimeTurnResult } from "@persai/runtime-contract";
import { TurnExecutionService } from "../../turn-execution.service";

@Controller("api/v1/turns")
export class TurnsController {
  constructor(private readonly turnExecutionService: TurnExecutionService) {}

  @Post("create")
  createTurn(@Body() body: RuntimeTurnRequest): Promise<RuntimeTurnResult> {
    return this.turnExecutionService.createTurn(body);
  }
}
