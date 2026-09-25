import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { CurrentUser, ReqContext, RequirePermissions } from '../common/decorators';
import {
  AssignScheduleDto,
  CreateHolidayDto,
  CreateScheduleDto,
  CreateShiftDto,
  UpdateScheduleDto,
  UpdateShiftDto,
} from './work-schedules.dto';
import { WorkSchedulesService } from './work-schedules.service';

@ApiTags('Work schedules')
@ApiBearerAuth()
@Controller()
export class WorkSchedulesController {
  constructor(private readonly schedules: WorkSchedulesService) {}

  @Get('work-shifts')
  @RequirePermissions('schedules:read')
  listShifts() {
    return this.schedules.listShifts();
  }

  @Post('work-shifts')
  @RequirePermissions('schedules:write')
  @ApiOperation({
    summary: 'Create a shift template (night shifts: endTime earlier than startTime)',
  })
  createShift(
    @Body() dto: CreateShiftDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.schedules.createShift(dto, actor, ctx);
  }

  @Patch('work-shifts/:id')
  @RequirePermissions('schedules:write')
  updateShift(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShiftDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.schedules.updateShift(id, dto, actor, ctx);
  }

  @Get('work-schedules')
  @RequirePermissions('schedules:read')
  listSchedules() {
    return this.schedules.listSchedules();
  }

  @Get('work-schedules/:id')
  @RequirePermissions('schedules:read')
  getSchedule(@Param('id', ParseUUIDPipe) id: string) {
    return this.schedules.getSchedule(id);
  }

  @Post('work-schedules')
  @RequirePermissions('schedules:write')
  @ApiOperation({ summary: 'Create a weekly schedule' })
  createSchedule(
    @Body() dto: CreateScheduleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.schedules.createSchedule(dto, actor, ctx);
  }

  @Patch('work-schedules/:id')
  @RequirePermissions('schedules:write')
  updateSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateScheduleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.schedules.updateSchedule(id, dto, actor, ctx);
  }

  @Post('work-schedules/assignments')
  @RequirePermissions('schedules:write')
  @ApiOperation({
    summary: 'Assign a schedule to an employee from a date',
    description: 'Closes the previous assignment and recomputes affected past days (max 62).',
  })
  assign(
    @Body() dto: AssignScheduleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.schedules.assign(dto, actor, ctx);
  }

  @Delete('work-schedules/assignments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('schedules:write')
  @ApiOperation({
    summary: "Undo an employee's latest schedule assignment",
    description:
      'The previous assignment runs open-ended again and affected past days are recomputed. ' +
      'Earlier assignments, and ones that started more than 62 days ago, cannot be undone.',
  })
  unassign(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.schedules.unassign(id, actor, ctx);
  }

  @Get('employees/:employeeId/schedules')
  @RequirePermissions('schedules:read')
  listAssignments(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.schedules.listAssignments(employeeId);
  }

  @Get('holidays')
  @RequirePermissions('schedules:read')
  @ApiQuery({ name: 'year', required: false, example: 2026 })
  listHolidays(@Query('year', new ParseIntPipe({ optional: true })) year?: number) {
    return this.schedules.listHolidays(year);
  }

  @Post('holidays')
  @RequirePermissions('schedules:write')
  createHoliday(
    @Body() dto: CreateHolidayDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.schedules.createHoliday(dto, actor, ctx);
  }

  @Delete('holidays/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('schedules:write')
  removeHoliday(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.schedules.removeHoliday(id, actor, ctx);
  }
}
