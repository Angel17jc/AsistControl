import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

const DB_TIMEOUT_MS = 2_000;

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: 'Liveness + database connectivity (used by Docker and load balancers)' })
  @ApiOkResponse({
    schema: {
      example: {
        status: 'ok',
        database: 'connected',
        uptimeSeconds: 42,
        timestamp: '2026-09-21T13:00:00.000Z',
      },
    },
  })
  @ApiServiceUnavailableResponse({ description: 'Database unreachable' })
  async check(@Res({ passthrough: true }) res: Response) {
    const started = Date.now();
    let timer: NodeJS.Timeout | undefined;
    const database = await Promise.race([
      this.prisma.$queryRaw`SELECT 1`.then(() => 'connected' as const),
      new Promise<'timeout'>(
        (resolve) => (timer = setTimeout(() => resolve('timeout'), DB_TIMEOUT_MS)),
      ),
    ])
      .catch(() => 'disconnected' as const)
      .finally(() => clearTimeout(timer));

    const ok = database === 'connected';
    if (!ok) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: ok ? 'ok' : 'error',
      database,
      databaseLatencyMs: ok ? Date.now() - started : null,
      uptimeSeconds: Math.round(process.uptime()),
      version: process.env.npm_package_version ?? '0.1.0',
      timestamp: new Date().toISOString(),
    };
  }
}
