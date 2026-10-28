import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { CurrentUser, ReqContext, RequirePermissions } from '../common/decorators';
import { AttendanceService } from './attendance.service';
import { PresenceService } from './presence.service';
import {
  CreateManualEventDto,
  CreateManualEventsDto,
  EventsQueryDto,
  PreviewManualEventsDto,
  RecomputeDto,
  RecordsQueryDto,
  VoidEventDto,
} from './dto/attendance.dto';

@ApiTags('Attendance')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly presence: PresenceService,
  ) {}

  @Get('records')
  @RequirePermissions('attendance:read')
  @ApiOperation({
    summary: 'Daily attendance summaries',
    description: 'Scoped by role: supervisors see their team, employees only themselves.',
  })
  records(@Query() query: RecordsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendance.listRecords(query, user);
  }

  @Get('presence')
  @RequirePermissions('dashboard:read')
  @ApiOperation({
    summary: 'Who is in right now',
    description:
      'Each active employee in scope with their state (in, at lunch, gone, not arrived, ' +
      'not yet, on leave, day off, no schedule), first entry, lateness and last punch.',
  })
  presenceBoard(@CurrentUser() user: AuthenticatedUser) {
    return this.presence.board(user);
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

  @Post('events/batch')
  @RequirePermissions('attendance:write')
  @ApiOperation({
    summary: 'Register several manual punches of one employee at once (e.g. a whole day)',
    description: 'All of them are saved, or none. Each one is audited with the same reason.',
  })
  createManualBatch(
    @Body() dto: CreateManualEventsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.attendance.createManualEvents(dto, actor, ctx);
  }

  @Post('events/preview')
  @HttpCode(200)
  @RequirePermissions('attendance:write')
  @ApiOperation({
    summary: 'Show how manual punches would be read, without saving them',
    description:
      'Returns the work day they fall on: its shift, every punch with how it is read ' +
      '(entry, lunch, exit, duplicate, another day) and the summary before and after.',
  })
  preview(@Body() dto: PreviewManualEventsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.attendance.previewManualEvents(dto, actor);
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
