import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { CurrentUser, ReqContext, RequirePermissions } from '../common/decorators';
import { CreateVacationAdjustmentDto, VacationBalanceQueryDto } from './vacations.dto';
import { VacationsService } from './vacations.service';

@ApiTags('Vacations')
@ApiBearerAuth()
@Controller('employees/:employeeId')
export class VacationsController {
  constructor(private readonly vacations: VacationsService) {}

  @Get('vacation-balance')
  @RequirePermissions('leave:read')
  @ApiOperation({
    summary: 'Vacation balance: accrued, adjusted, used, scheduled, pending and available days',
    description:
      'Recomputed on every read from the contract type, hire date, requests and adjustments. ' +
      'Scoped: an employee sees their own, a supervisor their team.',
  })
  balance(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query() query: VacationBalanceQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vacations.balance(employeeId, user, query.asOf);
  }

  @Post('vacation-adjustments')
  @RequirePermissions('employees:write')
  @ApiOperation({
    summary: 'Add or withdraw vacation days by hand (opening balance, correction). Audited.',
  })
  adjust(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: CreateVacationAdjustmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.vacations.addAdjustment(employeeId, dto, actor, ctx);
  }
}
