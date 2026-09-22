import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ATTENDANCE_STATUSES,
  type AttendanceStatus,
  PUNCH_TYPES,
  type PunchType,
} from '@asistcontrol/shared';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { DATE_ONLY_REGEX } from '../../common/utils/date-only';

const DATE = { message: 'must be a date in YYYY-MM-DD format' };

export class DateRangeQueryDto extends PaginationQueryDto {
  @ApiProperty({ example: '2026-09-01' })
  @Matches(DATE_ONLY_REGEX, DATE)
  from: string;

  @ApiProperty({ example: '2026-09-30' })
  @Matches(DATE_ONLY_REGEX, DATE)
  to: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

export class RecordsQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ enum: ATTENDANCE_STATUSES })
  @IsOptional()
  @IsIn(ATTENDANCE_STATUSES)
  status?: AttendanceStatus;
}

export class EventsQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @ApiPropertyOptional({ description: 'Only punches whose biometric id matches no employee' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unmatched?: boolean;
}

export class CreateManualEventDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  employeeId: string;

  @ApiProperty({ example: '2026-09-21T13:02:00.000Z' })
  @IsISO8601({ strict: true })
  occurredAt: string;

  @ApiPropertyOptional({ enum: PUNCH_TYPES, default: 'UNKNOWN' })
  @IsOptional()
  @IsIn(PUNCH_TYPES)
  punchType?: PunchType;

  @ApiProperty({ description: 'Mandatory justification, kept in the audit trail' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class VoidEventDto {
  @ApiProperty()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class RecomputeDto {
  @ApiProperty({ example: '2026-09-01' })
  @Matches(DATE_ONLY_REGEX, DATE)
  from: string;

  @ApiProperty({ example: '2026-09-21' })
  @Matches(DATE_ONLY_REGEX, DATE)
  to: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}
