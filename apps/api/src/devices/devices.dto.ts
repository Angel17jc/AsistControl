import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { isValidTimeZone } from '@asistcontrol/biometric-core';
import { DEVICE_DRIVERS, type DeviceDriver } from '@asistcontrol/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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

  @ApiPropertyOptional({
    example: 'America/Guayaquil',
    description:
      'IANA timezone the terminal is configured with. Devices report local wall-clock time; ' +
      'defaults to the company timezone. Set it for a site in another zone.',
  })
  @IsOptional()
  @ValidateBy({
    name: 'isTimeZone',
    validator: {
      validate: (v: unknown) => typeof v === 'string' && isValidTimeZone(v),
      defaultMessage: () => 'timezone must be a valid IANA timezone',
    },
  })
  timezone?: string;

  @ApiPropertyOptional({
    enum: ['http', 'https'],
    default: 'http',
    description:
      'HIKVISION: transport for ISAPI. HTTPS needs a certificate the API trusts ' +
      '(NODE_EXTRA_CA_CERTS); verification is never switched off.',
  })
  @IsOptional()
  @IsIn(['http', 'https'])
  protocol?: 'http' | 'https';

  @ApiPropertyOptional({
    type: [Number],
    example: [75, 38, 1],
    description:
      'HIKVISION: event minor codes treated as punches. Default: face (75), fingerprint (38) ' +
      'and card (1) authentication passed.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(65_535, { each: true })
  eventMinors?: number[];

  @ApiPropertyOptional({
    default: 31,
    description: 'HIKVISION: days read on the first sync, or when the cursor cannot be trusted.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(366)
  initialLookbackDays?: number;

  @ApiPropertyOptional({
    default: 60,
    description: 'HIKVISION: minutes re-read before the newest event already downloaded.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_440)
  overlapMinutes?: number;
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
    description:
      'Driver credentials, stored encrypted and never returned. ' +
      'ZKTECO: { commKey }. HIKVISION: { username, password } of an ISAPI user.',
    example: { username: 'admin', password: '********' },
  })
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;
}

export class UpdateDeviceDto extends PartialType(OmitType(CreateDeviceDto, ['credentials'])) {
  @ApiPropertyOptional({ description: 'false = DISABLED (no sync, no realtime)' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'New credentials, stored encrypted and never returned. Omit to keep the current ones, ' +
      'null to remove them. Changing the driver without sending new ones removes them too.',
    example: { username: 'asistencia', password: '********' },
  })
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string> | null;
}
