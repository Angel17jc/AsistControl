import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Search the append-only audit trail' })
  list(@Query() query: AuditQueryDto) {
    return this.audit.list(query);
  }
}
