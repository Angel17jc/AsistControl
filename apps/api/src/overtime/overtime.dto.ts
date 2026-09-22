import { ApiPropertyOptional } from '@nestjs/swagger';
import { REQUEST_STATUSES, type RequestStatus } from '@asistcontrol/shared';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { DATE_ONLY_REGEX } from '../common/utils/date-only';

export class OvertimeQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: REQUEST_STATUSES })
  @IsOptional()
  @IsIn(REQUEST_STATUSES)
  status?: RequestStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @Matches(DATE_ONLY_REGEX)
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @Matches(DATE_ONLY_REGEX)
  to?: string;
}
