import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotEquals,
} from 'class-validator';
import { DATE_ONLY_REGEX } from '../common/utils/date-only';

export class VacationBalanceQueryDto {
  @ApiPropertyOptional({
    example: '2026-12-31',
    description: 'Balance on this date; default today',
  })
  @IsOptional()
  @Matches(DATE_ONLY_REGEX)
  asOf?: string;
}

export class CreateVacationAdjustmentDto {
  @ApiProperty({
    example: 4.5,
    description: 'Days to add (positive) or withdraw (negative), up to two decimals',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @NotEquals(0)
  @Min(-365)
  @Max(365)
  days: number;

  @ApiProperty({ example: 'Saldo pendiente del sistema anterior al 31/08/2026' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
