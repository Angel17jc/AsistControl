import { ApiProperty, ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
import { PASSWORD_RULE, ROLES, type Role } from '@asistcontrol/shared';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateUserDto {
  @ApiProperty({ example: 'rrhh@empresa.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiPropertyOptional({
    minLength: 10,
    description:
      'Temporary password, replaced by its owner at first sign-in. Required unless `invite`.',
  })
  // With an invitation there is no password: the person chooses it from the email.
  @ValidateIf((dto: CreateUserDto) => dto.invite !== true)
  @IsString()
  @Matches(PASSWORD_RULE, {
    message: 'password must have at least 10 characters, letters and numbers',
  })
  password?: string;

  @ApiPropertyOptional({
    description:
      'Email the person a link to choose their own password (valid 72 h) instead of giving a ' +
      'temporary one (ADR 0016).',
  })
  @IsOptional()
  @IsBoolean()
  invite?: boolean;

  @ApiProperty({ enum: ROLES })
  @IsIn(ROLES)
  role: Role;

  @ApiPropertyOptional({ format: 'uuid', description: 'Employee linked to this account' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}

export class UpdateUserDto extends PartialType(PickType(CreateUserDto, ['role'] as const)) {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Employee to link; null unlinks (not allowed for SUPERVISOR or EMPLOYEE)',
  })
  @IsOptional()
  @IsUUID()
  employeeId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ResetPasswordDto {
  @ApiProperty({ minLength: 10 })
  @IsString()
  @MinLength(10)
  @Matches(PASSWORD_RULE, {
    message: 'password must have at least 10 characters, letters and numbers',
  })
  password: string;
}

export class UserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ROLES })
  @IsOptional()
  @IsIn(ROLES)
  role?: Role;
}
