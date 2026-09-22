import { BadRequestException, Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { REPORT_KINDS, type ReportKind, ReportQueryDto } from './reports.dto';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get(':kind')
  @RequirePermissions('reports:read')
  @ApiParam({ name: 'kind', enum: REPORT_KINDS })
  @ApiProduces('application/json', 'text/csv')
  @ApiOperation({
    summary: 'Attendance reports: daily, monthly, late, absences, overtime, events, sync',
    description: 'Add `format=csv` to download a spreadsheet-safe CSV file.',
  })
  async report(
    @Param('kind') kind: string,
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!(REPORT_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException(`Unknown report. Available: ${REPORT_KINDS.join(', ')}`);
    }
    const report = await this.reports.build(kind as ReportKind, query, user);
    if (query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="asistcontrol-${kind}-${report.from}_${report.to}.csv"`,
      );
      return this.reports.toCsv(report);
    }
    return {
      kind: report.kind,
      from: report.from,
      to: report.to,
      total: report.rows.length,
      rows: report.rows,
    };
  }
}
