import { ApiProperty } from '@nestjs/swagger';
import { PASSWORD_RULE } from '@asistcontrol/shared';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ format: 'password', description: 'The password the account uses today' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword: string;

  @ApiProperty({
    format: 'password',
    minLength: 10,
    description: 'At least 10 characters, letters and numbers; different from the current one',
  })
  @IsString()
  @Matches(PASSWORD_RULE, {
    message: 'newPassword must have at least 10 characters, letters and numbers',
  })
  newPassword: string;
}
