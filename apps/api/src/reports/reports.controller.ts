import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { apiError } from '../common/errors/api-error';
import { REPORT_KINDS, type ReportKind, ReportQueryDto } from './reports.dto';
import { ReportsService } from './reports.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get(':kind')
  @RequirePermissions('reports:read')
  @ApiParam({ name: 'kind', enum: REPORT_KINDS })
  @ApiProduces('application/json', 'text/csv', XLSX, 'application/pdf')
  @ApiOperation({
    summary:
      'Attendance reports: attendance, daily, monthly, late, absences, overtime, events, sync',
    description:
      'Add `format=xlsx` for an Excel workbook, `format=csv` for other systems, or, on the ' +
      "month's attendance, `format=pdf` for a document to sign.",
  })
  async report(
    @Param('kind') kind: string,
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!(REPORT_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException(
        apiError('REPORT_UNKNOWN', `Unknown report. Available: ${REPORT_KINDS.join(', ')}`),
      );
    }
    if (query.format === 'pdf' && kind !== 'attendance') {
      throw new BadRequestException(
        apiError('REPORT_FORMAT_UNSUPPORTED', 'Only the attendance report comes as a PDF'),
      );
    }
    if (query.format === 'xlsx' || query.format === 'pdf') {
      const file = await this.reports.file(kind as ReportKind, query.format, query, user);
      return new StreamableFile(file.content, {
        type: query.format === 'pdf' ? 'application/pdf' : XLSX,
        disposition: `attachment; filename="${file.name}"`,
        length: file.content.length,
      });
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
