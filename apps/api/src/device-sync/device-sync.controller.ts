import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { CurrentUser, ReqContext, RequirePermissions } from '../common/decorators';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { DeviceSyncService } from './device-sync.service';

@ApiTags('Device sync')
@ApiBearerAuth()
@Controller()
export class DeviceSyncController {
  constructor(private readonly sync: DeviceSyncService) {}

  @Post('devices/:id/sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('devices:sync')
  @ApiOperation({
    summary: 'Download new punches from the device now',
    description:
      'Runs validation → normalization → deduplication → attendance recomputation. Idempotent: ' +
      're-running never duplicates punches. Returns the resulting sync log.',
  })
  @ApiConflictResponse({ description: 'A sync is already running for this device' })
  run(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.sync.sync(id, 'MANUAL', actor, ctx);
  }

  @Get('devices/:id/sync-logs')
  @RequirePermissions('devices:read')
  deviceLogs(@Param('id', ParseUUIDPipe) id: string, @Query() query: PaginationQueryDto) {
    return this.sync.listLogs(query, id);
  }

  @Get('sync-logs')
  @RequirePermissions('devices:read')
  @ApiOperation({ summary: 'Synchronization history of all devices' })
  logs(@Query() query: PaginationQueryDto) {
    return this.sync.listLogs(query);
  }
}
