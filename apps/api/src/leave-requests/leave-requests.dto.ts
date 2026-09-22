import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  LEAVE_TYPES,
  type LeaveType,
  REQUEST_STATUSES,
  type RequestStatus,
} from '@asistcontrol/shared';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';

export class CreateLeaveRequestDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Defaults to the requesting user’s employee',
  })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiProperty({ enum: LEAVE_TYPES })
  @IsIn(LEAVE_TYPES)
  type: LeaveType;

  @ApiProperty({
    example: '2026-09-22T13:00:00.000Z',
    description: 'Hour-level permissions and full days alike',
  })
  @IsISO8601({ strict: true })
  startsAt: string;

  @ApiProperty({ example: '2026-09-22T15:00:00.000Z' })
  @IsISO8601({ strict: true })
  endsAt: string;

  @ApiProperty({ example: 'Cita médica' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class LeaveQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: REQUEST_STATUSES })
  @IsOptional()
  @IsIn(REQUEST_STATUSES)
  status?: RequestStatus;

  @ApiPropertyOptional({ enum: LEAVE_TYPES })
  @IsOptional()
  @IsIn(LEAVE_TYPES)
  type?: LeaveType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}
