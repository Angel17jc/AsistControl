import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { NOTIFICATION_TYPES, type NotificationType } from '@asistcontrol/shared';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';

export class NotificationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only notifications not read yet' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unread?: boolean;
}

/** Either setting, or both; an empty body is refused. */
export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({ description: 'Also receive my notifications by email' })
  // Validated when present, or when mutedTypes is absent too: an empty body fails.
  @ValidateIf(
    (dto: UpdateNotificationPreferencesDto) =>
      dto.emailNotifications !== undefined || dto.mutedTypes === undefined,
  )
  @IsBoolean()
  emailNotifications?: boolean;

  @ApiPropertyOptional({
    enum: NOTIFICATION_TYPES,
    isArray: true,
    description: 'Types NOT to receive by email (they still reach the bell). Replaces the list.',
  })
  @ValidateIf(
    (dto: UpdateNotificationPreferencesDto) =>
      dto.mutedTypes !== undefined || dto.emailNotifications === undefined,
  )
  @IsArray()
  @ArrayMaxSize(NOTIFICATION_TYPES.length)
  @IsIn(NOTIFICATION_TYPES, { each: true })
  mutedTypes?: NotificationType[];
}
