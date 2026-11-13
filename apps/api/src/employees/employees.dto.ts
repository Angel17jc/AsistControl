import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { EMPLOYEE_STATUSES, type EmployeeStatus } from '@asistcontrol/shared';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { DATE_ONLY_REGEX } from '../common/utils/date-only';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateEmployeeDto {
  @ApiProperty({ example: 'EMP-0001', description: 'Internal company code' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9-]{2,20}$/, { message: 'employeeCode must be 2-20 letters, digits or -' })
  employeeCode: string;

  @ApiProperty({ example: '0912345678', description: 'National ID / passport' })
  @Transform(trim)
  @Matches(/^[A-Za-z0-9-]{5,20}$/, { message: 'identification must be 5-20 letters, digits or -' })
  identification: string;

  @ApiProperty({ example: 'Angel' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName: string;

  @ApiProperty({ example: 'Conforme' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName: string;

  @ApiPropertyOptional({ example: 'angel.conforme@empresa.com' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+593 99 123 4567' })
  @IsOptional()
  @Matches(/^[+\d\s()-]{6,20}$/, { message: 'phone has an invalid format' })
  phone?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  positionId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Decides the vacation entitlement; without one there is no vacation balance',
  })
  @IsOptional()
  @IsUUID()
  contractTypeId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supervisorId?: string;

  @ApiProperty({ example: '2024-01-15' })
  @Matches(DATE_ONLY_REGEX, { message: 'hireDate must be YYYY-MM-DD' })
  hireDate: string;

  @ApiPropertyOptional({
    example: '1001',
    description: 'User id enrolled on the biometric terminals',
  })
  @IsOptional()
  @Transform(trim)
  @Matches(/^[A-Za-z0-9]{1,24}$/, { message: 'biometricId must be 1-24 letters or digits' })
  biometricId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Weekly schedule from the hire date. Changing it later has its own endpoint',
  })
  @IsOptional()
  @IsUUID()
  scheduleId?: string;
}

export class UpdateEmployeeDto extends PartialType(OmitType(CreateEmployeeDto, ['scheduleId'])) {
  @ApiPropertyOptional({ enum: EMPLOYEE_STATUSES })
  @IsOptional()
  @IsIn(EMPLOYEE_STATUSES)
  status?: EmployeeStatus;

  @ApiPropertyOptional({
    example: '2026-12-31',
    nullable: true,
    description: 'Last working day; null clears it when someone is reinstated',
  })
  @IsOptional()
  @Matches(DATE_ONLY_REGEX, { message: 'terminatedAt must be YYYY-MM-DD' })
  terminatedAt?: string | null;
}

export class EmployeeQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: EMPLOYEE_STATUSES })
  @IsOptional()
  @IsIn(EMPLOYEE_STATUSES)
  status?: EmployeeStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

/** One person from a terminal, with the name split the way HR confirmed it. */
export class ImportPersonDto {
  @ApiProperty({ example: '12', description: 'Their user number on the terminal' })
  @Transform(trim)
  @Matches(/^[A-Za-z0-9]{1,24}$/, { message: 'biometricId must be 1-24 letters or digits' })
  biometricId: string;

  @ApiProperty({ example: 'Melanie' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName: string;

  @ApiProperty({ example: 'Zambrano' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName: string;

  @ApiPropertyOptional({
    example: 'EMP-012',
    description: 'Internal code; without one, EMP- and the terminal number (EMP-012)',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9-]{2,20}$/, { message: 'employeeCode must be 2-20 letters, digits or -' })
  employeeCode?: string;
}

/** Employees from the people on a terminal (their cédula is filled in later). */
export class ImportEmployeesDto {
  @ApiProperty({ type: [ImportPersonDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ImportPersonDto)
  people: ImportPersonDto[];

  @ApiProperty({ example: '2026-11-01', description: 'Hire date for all of them' })
  @Matches(DATE_ONLY_REGEX, { message: 'hireDate must be YYYY-MM-DD' })
  hireDate: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Weekly schedule for all of them' })
  @IsOptional()
  @IsUUID()
  scheduleId?: string;
}
