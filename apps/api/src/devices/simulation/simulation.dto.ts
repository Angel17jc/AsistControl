import { ApiPropertyOptional } from '@nestjs/swagger';
import { WORKDAY_SCENARIOS, type WorkdayScenario } from '@asistcontrol/biometric-core';
import { PUNCH_TYPES, type PunchType } from '@asistcontrol/shared';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { DATE_ONLY_REGEX } from '../../common/utils/date-only';

export class SimulatePunchDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Employee to punch for (uses their biometricId)',
  })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({
    description: 'Raw device user id (e.g. an id not enrolled in the system)',
  })
  @IsOptional()
  @IsString()
  deviceUserId?: string;

  @ApiPropertyOptional({ enum: PUNCH_TYPES })
  @IsOptional()
  @IsIn(PUNCH_TYPES)
  punchType?: PunchType;
}

export const SCENARIOS_WITH_MIXED = [...WORKDAY_SCENARIOS, 'MIXED'] as const;

export class SimulateWorkdayDto {
  @ApiPropertyOptional({ example: '2026-09-21', description: 'Defaults to today' })
  @IsOptional()
  @Matches(DATE_ONLY_REGEX)
  date?: string;

  @ApiPropertyOptional({ enum: SCENARIOS_WITH_MIXED, default: 'MIXED' })
  @IsOptional()
  @IsIn(SCENARIOS_WITH_MIXED)
  scenario?: WorkdayScenario | 'MIXED';

  @ApiPropertyOptional({
    type: [String],
    description: 'Defaults to every active employee with biometricId',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  employeeIds?: string[];
}

export class SimulateFaultsDto {
  @ApiPropertyOptional({ description: 'false = unplug the device from the network' })
  @IsOptional()
  @IsBoolean()
  online?: boolean;

  @ApiPropertyOptional({ enum: ['TIMEOUT', 'PROTOCOL', 'CONNECTION'] })
  @IsOptional()
  @IsIn(['TIMEOUT', 'PROTOCOL', 'CONNECTION'])
  failNext?: 'TIMEOUT' | 'PROTOCOL' | 'CONNECTION';

  @ApiPropertyOptional({ description: 'Drop the connection after N operations' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  dropConnectionAfter?: number;

  @ApiPropertyOptional({ description: 'Device returns every record twice' })
  @IsOptional()
  @IsBoolean()
  duplicateOnRead?: boolean;

  @ApiPropertyOptional({ description: 'Network latency per operation (ms)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30_000)
  latencyMs?: number;

  @ApiPropertyOptional({ description: 'Device clock drift (seconds, can be negative)' })
  @IsOptional()
  @IsInt()
  @Min(-86_400)
  @Max(86_400)
  clockSkewSeconds?: number;

  @ApiPropertyOptional({ description: 'Remove every injected fault' })
  @IsOptional()
  @IsBoolean()
  reset?: boolean;
}

export class SimulateAutoDto {
  @ApiPropertyOptional({ description: 'Interval between random punches (ms). Omit or 0 to stop.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600_000)
  intervalMs?: number;
}
