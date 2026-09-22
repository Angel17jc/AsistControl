import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { CurrentUser, ReqContext, RequirePermissions } from '../common/decorators';
import { CreateDeviceDto, UpdateDeviceDto } from './devices.dto';
import { DevicesService } from './devices.service';
import { DeviceSimulationService } from './simulation/device-simulation.service';
import {
  SimulateAutoDto,
  SimulateFaultsDto,
  SimulatePunchDto,
  SimulateWorkdayDto,
} from './simulation/simulation.dto';

@ApiTags('Devices')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly simulation: DeviceSimulationService,
  ) {}

  @Get()
  @RequirePermissions('devices:read')
  list() {
    return this.devices.list();
  }

  @Get('drivers')
  @RequirePermissions('devices:read')
  @ApiOperation({ summary: 'Drivers (adapters) available in this deployment' })
  drivers() {
    return this.devices.supportedDrivers();
  }

  @Get(':id')
  @RequirePermissions('devices:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.get(id);
  }

  @Post()
  @RequirePermissions('devices:write')
  @ApiOperation({ summary: 'Register a biometric device on the LAN' })
  create(
    @Body() dto: CreateDeviceDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.devices.create(dto, actor, ctx);
  }

  @Patch(':id')
  @RequirePermissions('devices:write')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeviceDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.devices.update(id, dto, actor, ctx);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('devices:write')
  @ApiOperation({ summary: 'Retire a device (soft delete, punches are kept)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.devices.remove(id, actor, ctx);
  }

  @Post(':id/test-connection')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('devices:sync')
  @ApiOperation({ summary: 'Probe the device: reachability, latency, info and clock drift' })
  testConnection(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.testConnection(id);
  }

  // ───────────────────────── mock simulator (MOCK driver only, disabled in production)

  @Get(':id/simulate')
  @RequirePermissions('devices:write')
  @ApiOperation({ summary: '[Mock] Virtual terminal state' })
  simulationState(@Param('id', ParseUUIDPipe) id: string) {
    return this.simulation.state(id);
  }

  @Post(':id/simulate/punch')
  @RequirePermissions('devices:write')
  @ApiOperation({ summary: '[Mock] Someone punches on the terminal now' })
  simulatePunch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SimulatePunchDto) {
    return this.simulation.punch(id, dto);
  }

  @Post(':id/simulate/workday')
  @RequirePermissions('devices:write')
  @ApiOperation({ summary: '[Mock] Generate a full day of punches (ON_TIME, LATE, MIXED…)' })
  simulateWorkday(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SimulateWorkdayDto) {
    return this.simulation.workday(id, dto);
  }

  @Post(':id/simulate/faults')
  @RequirePermissions('devices:write')
  @ApiOperation({
    summary: '[Mock] Inject disconnections, timeouts, duplicates, latency, clock drift',
  })
  simulateFaults(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SimulateFaultsDto) {
    return this.simulation.faults(id, dto);
  }

  @Post(':id/simulate/auto')
  @RequirePermissions('devices:write')
  @ApiOperation({ summary: '[Mock] Emit random live punches every N ms (0 stops)' })
  simulateAuto(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SimulateAutoDto) {
    return this.simulation.auto(id, dto.intervalMs);
  }
}
