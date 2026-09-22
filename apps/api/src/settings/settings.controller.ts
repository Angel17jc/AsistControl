import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AttendancePolicy } from '../attendance/domain/attendance-policy';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { CurrentUser, ReqContext, RequirePermissions } from '../common/decorators';
import { SettingsService } from './settings.service';

@ApiTags('Settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions('settings:read')
  @ApiOperation({ summary: 'Company timezone and attendance policy in effect' })
  get() {
    return this.settings.getAll();
  }

  @Patch('attendance-policy')
  @RequirePermissions('settings:write')
  @ApiOperation({
    summary: 'Update labor rules (tolerances, overtime basis, pairing mode…)',
    description: 'Partial update validated against the policy schema. Changes are audited.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      example: { lateToleranceMinutes: 10, overtimeThresholdMinutes: 30 },
    },
  })
  update(
    @Body() body: Partial<AttendancePolicy>,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.settings.updateAttendancePolicy(body, user, ctx);
  }
}
