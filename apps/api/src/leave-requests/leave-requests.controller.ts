import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { CurrentUser, ReqContext, RequirePermissions } from '../common/decorators';
import { ReviewDto } from '../common/dto/review.dto';
import { CreateLeaveRequestDto, LeaveQueryDto } from './leave-requests.dto';
import { LeaveRequestsService } from './leave-requests.service';

@ApiTags('Leave requests (permissions & vacations)')
@ApiBearerAuth()
@Controller('leave-requests')
export class LeaveRequestsController {
  constructor(private readonly leaves: LeaveRequestsService) {}

  @Get()
  @RequirePermissions('leave:read')
  list(@Query() query: LeaveQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.leaves.list(query, user);
  }

  @Post()
  @RequirePermissions('leave:request')
  @ApiOperation({
    summary: 'Request a permission or vacation (for yourself, or your team if allowed)',
  })
  create(
    @Body() dto: CreateLeaveRequestDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.leaves.create(dto, actor, ctx);
  }

  @Post(':id/review')
  @RequirePermissions('leave:approve')
  @ApiOperation({ summary: 'Approve or reject. Approval recomputes the affected attendance days.' })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.leaves.review(id, dto, actor, ctx);
  }

  @Post(':id/cancel')
  @RequirePermissions('leave:request')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.leaves.cancel(id, actor, ctx);
  }
}
