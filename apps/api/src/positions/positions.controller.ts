import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { CurrentUser, ReqContext, RequirePermissions } from '../common/decorators';
import { CreatePositionDto, UpdatePositionDto } from './positions.dto';
import { PositionsService } from './positions.service';

@ApiTags('Positions')
@ApiBearerAuth()
@Controller('positions')
export class PositionsController {
  constructor(private readonly positions: PositionsService) {}

  @Get()
  @RequirePermissions('organization:read')
  list() {
    return this.positions.list();
  }

  @Get(':id')
  @RequirePermissions('organization:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.positions.get(id);
  }

  @Post()
  @RequirePermissions('organization:write')
  create(
    @Body() dto: CreatePositionDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.positions.create(dto, actor, ctx);
  }

  @Patch(':id')
  @RequirePermissions('organization:write')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePositionDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.positions.update(id, dto, actor, ctx);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('organization:write')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.positions.remove(id, actor, ctx);
  }
}
