import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DATE_ONLY_REGEX } from '../common/utils/date-only';
import { HHMM_REGEX } from '../attendance/domain/work-day';

const HHMM = { message: 'must be a time in HH:mm format' };
const DATE = { message: 'must be a date in YYYY-MM-DD format' };

export class CreateShiftDto {
  @ApiProperty({ example: 'Oficina 08:00-17:00' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: '08:00' })
  @Matches(HHMM_REGEX, HHMM)
  startTime: string;

  @ApiProperty({ example: '17:00', description: 'Earlier than startTime = crosses midnight' })
  @Matches(HHMM_REGEX, HHMM)
  endTime: string;

  @ApiPropertyOptional({ example: '12:00' })
  @IsOptional()
  @Matches(HHMM_REGEX, HHMM)
  breakStart?: string;

  @ApiPropertyOptional({ example: '13:00' })
  @IsOptional()
  @Matches(HHMM_REGEX, HHMM)
  breakEnd?: string;

  @ApiPropertyOptional({ description: 'Overrides the policy tolerance for this shift' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  lateToleranceMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  earlyLeaveToleranceMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(480)
  overtimeThresholdMinutes?: number;
}

export class UpdateShiftDto extends PartialType(CreateShiftDto) {}

export class ScheduleDayDto {
  @ApiProperty({ minimum: 1, maximum: 7, description: 'ISO weekday, 1 = Monday' })
  @IsInt()
  @Min(1)
  @Max(7)
  weekday: number;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  shiftId: string;
}

export class CreateScheduleDto {
  @ApiProperty({ example: 'Administrativo L-V' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ type: [ScheduleDayDto], description: 'Weekdays not listed are rest days' })
  @IsArray()
  @ArrayMaxSize(7)
  @ArrayUnique((d: ScheduleDayDto) => d.weekday)
  @ValidateNested({ each: true })
  @Type(() => ScheduleDayDto)
  days: ScheduleDayDto[];
}

export class UpdateScheduleDto extends PartialType(CreateScheduleDto) {}

export class AssignScheduleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  employeeId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  scheduleId: string;

  @ApiProperty({ example: '2026-09-01' })
  @Matches(DATE_ONLY_REGEX, DATE)
  effectiveFrom: string;
}

export class CreateHolidayDto {
  @ApiProperty({ example: '2026-11-02' })
  @Matches(DATE_ONLY_REGEX, DATE)
  date: string;

  @ApiProperty({ example: 'Día de los Difuntos' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;
}
