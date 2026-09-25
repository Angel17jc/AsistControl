import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  VACATION_ACCRUALS,
  VACATION_DAY_COUNTINGS,
  type VacationAccrual,
  type VacationDayCounting,
} from '@asistcontrol/shared';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const days = { maxDecimalPlaces: 2 };

/** Extra days per service year once `afterYears` are completed, never beyond the cap. */
export class SeniorityDto {
  @ApiProperty({ example: 5, description: 'Completed years before the bonus starts' })
  @IsInt()
  @Min(0)
  @Max(60)
  afterYears: number;

  @ApiProperty({ example: 1, description: 'Days added for each further year of service' })
  @IsNumber(days)
  @Min(0.01)
  @Max(30)
  extraDaysPerYear: number;

  @ApiProperty({ example: 15, description: 'Cap on the bonus' })
  @IsNumber(days)
  @Min(0)
  @Max(365)
  maxExtraDays: number;
}

export class CreateContractTypeDto {
  @ApiProperty({ example: 'Tiempo completo' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @ApiProperty({ example: 15, description: 'Vacation days per service year (company policy)' })
  @IsNumber(days)
  @Min(0)
  @Max(365)
  vacationDaysPerYear: number;

  @ApiPropertyOptional({ enum: VACATION_ACCRUALS, default: 'ANNUAL' })
  @IsOptional()
  @IsIn(VACATION_ACCRUALS)
  vacationAccrual?: VacationAccrual;

  @ApiPropertyOptional({ enum: VACATION_DAY_COUNTINGS, default: 'WORKING_DAYS' })
  @IsOptional()
  @IsIn(VACATION_DAY_COUNTINGS)
  vacationDayCounting?: VacationDayCounting;

  @ApiPropertyOptional({ type: SeniorityDto, nullable: true, description: 'null = no bonus' })
  @IsOptional()
  @ValidateNested()
  @Type(() => SeniorityDto)
  seniority?: SeniorityDto | null;

  @ApiPropertyOptional({
    example: 24,
    nullable: true,
    description:
      'Unused days of a service year expire this many months after its anniversary; ' +
      'null = they never expire',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  vacationExpiryMonths?: number | null;

  @ApiPropertyOptional({
    default: false,
    description:
      'A single-day vacation covering at most half of that day’s working time costs half a day',
  })
  @IsOptional()
  @IsBoolean()
  allowHalfDayVacations?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'Allow requesting vacation beyond the available balance (an advance)',
  })
  @IsOptional()
  @IsBoolean()
  allowNegativeVacationBalance?: boolean;
}

export class UpdateContractTypeDto extends PartialType(CreateContractTypeDto) {}
