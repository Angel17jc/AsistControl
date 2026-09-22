import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { CurrentUser, ReqContext, RequirePermissions } from '../common/decorators';
import { AttendanceService } from './attendance.service';
import {
  CreateManualEventDto,
  EventsQueryDto,
  RecomputeDto,
  RecordsQueryDto,
  VoidEventDto,
} from './dto/attendance.dto';

@ApiTags('Attendance')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('records')
  @RequirePermissions('attendance:read')
  @ApiOperation({
    summary: 'Daily attendance summaries',
    description: 'Scoped by role: supervisors see their team, employees only themselves.',
  })
  records(@Query() query: RecordsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendance.listRecords(query, user);
  }

  @Get('events')
  @RequirePermissions('attendance:read')
  @ApiOperation({ summary: 'Raw punches (device and manual)' })
  events(@Query() query: EventsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendance.listEvents(query, user);
  }

  @Post('events')
  @RequirePermissions('attendance:write')
  @ApiOperation({ summary: 'Register a manual punch (correction). Requires a justification.' })
  createManual(
    @Body() dto: CreateManualEventDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.attendance.createManualEvent(dto, actor, ctx);
  }

  @Post('events/:id/void')
  @RequirePermissions('attendance:write')
  @ApiOperation({ summary: 'Discard an erroneous punch without deleting it' })
  void(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidEventDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.attendance.voidEvent(id, dto, actor, ctx);
  }

  @Post('recompute')
  @RequirePermissions('attendance:write')
  @ApiOperation({ summary: 'Rebuild attendance records from events (max 31 days)' })
  recompute(
    @Body() dto: RecomputeDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.attendance.recompute(dto, actor, ctx);
  }
}
