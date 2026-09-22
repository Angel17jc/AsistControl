import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import { DATE_ONLY_REGEX } from '../common/utils/date-only';

export const REPORT_KINDS = [
  'daily',
  'monthly',
  'late',
  'absences',
  'overtime',
  'events',
  'sync',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export class ReportQueryDto {
  @ApiProperty({
    example: '2026-09-01',
    description: 'For daily: the day. For monthly: any day of the month.',
  })
  @Matches(DATE_ONLY_REGEX, { message: 'from must be YYYY-MM-DD' })
  from: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Defaults to `from`' })
  @IsOptional()
  @Matches(DATE_ONLY_REGEX, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ enum: ['json', 'csv'], default: 'json' })
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}
