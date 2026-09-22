import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { CurrentUser, ReqContext, RequirePermissions } from '../common/decorators';
import { ReviewDto } from '../common/dto/review.dto';
import { OvertimeQueryDto } from './overtime.dto';
import { OvertimeService } from './overtime.service';

@ApiTags('Overtime')
@ApiBearerAuth()
@Controller('overtime')
export class OvertimeController {
  constructor(private readonly overtime: OvertimeService) {}

  @Get()
  @RequirePermissions('overtime:read')
  @ApiOperation({ summary: 'Overtime proposals and decisions (scoped by role)' })
  list(@Query() query: OvertimeQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.overtime.list(query, user);
  }

  @Post(':id/review')
  @RequirePermissions('overtime:approve')
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.overtime.review(id, dto, actor, ctx);
  }
}
