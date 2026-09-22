import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { DEVICE_DRIVERS, type DeviceDriver } from '@asistcontrol/shared';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  ValidateNested,
  isFQDN,
  isIP,
} from 'class-validator';

const IsHost = () =>
  ValidateBy({
    name: 'isHost',
    validator: {
      validate: (v: unknown) =>
        typeof v === 'string' && (isIP(v) || isFQDN(v, { require_tld: false })),
      defaultMessage: () => 'host must be an IP address or hostname',
    },
  });

export class DeviceConfigDto {
  @ApiPropertyOptional({ default: 5000, description: 'Per-operation timeout (ms)' })
  @IsOptional()
  @IsInt()
  @Min(500)
  @Max(60_000)
  timeoutMs?: number;

  @ApiPropertyOptional({
    default: true,
    description: 'Subscribe to live punches when the driver supports it',
  })
  @IsOptional()
  @IsBoolean()
  realtime?: boolean;
}

export class CreateDeviceDto {
  @ApiProperty({ example: 'Entrada principal' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ enum: DEVICE_DRIVERS, example: 'MOCK' })
  @IsIn(DEVICE_DRIVERS)
  driver: DeviceDriver;

  @ApiProperty({ example: 'ZKTeco' })
  @IsString()
  @MaxLength(60)
  manufacturer: string;

  @ApiProperty({ example: 'K40' })
  @IsString()
  @MaxLength(60)
  model: string;

  @ApiProperty({ example: '192.168.1.201' })
  @IsHost()
  host: string;

  @ApiProperty({ example: 4370 })
  @IsInt()
  @Min(1)
  @Max(65_535)
  port: number;

  @ApiPropertyOptional({ example: 'Planta baja - recepción' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @ApiPropertyOptional({ type: DeviceConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceConfigDto)
  config?: DeviceConfigDto;

  @ApiPropertyOptional({
    description: 'Driver credentials (e.g. comm key). Stored encrypted, never returned.',
    example: { commKey: '0' },
  })
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;
}

export class UpdateDeviceDto extends PartialType(CreateDeviceDto) {
  @ApiPropertyOptional({ description: 'false = DISABLED (no sync, no realtime)' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
