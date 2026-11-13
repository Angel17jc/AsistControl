import { ApiProperty } from '@nestjs/swagger';
import { PASSWORD_RULE } from '@asistcontrol/shared';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';

/** 32 random bytes in base64url: 43 characters of A-Z a-z 0-9 - _ */
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

export class ForgotPasswordDto {
  @ApiProperty({ example: 'melanie@empresa.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class PasswordLinkDto {
  @ApiProperty({ description: 'The token after # in the emailed link' })
  @IsString()
  @Matches(TOKEN_FORMAT, { message: 'token is not a password link token' })
  token: string;
}

export class ResetPasswordDto extends PasswordLinkDto {
  @ApiProperty({
    format: 'password',
    minLength: 10,
    description: 'At least 10 characters, letters and numbers',
  })
  @IsString()
  @Matches(PASSWORD_RULE, {
    message: 'newPassword must have at least 10 characters, letters and numbers',
  })
  newPassword: string;
}
