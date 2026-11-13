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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { CurrentUser, ReqContext, RequirePermissions } from '../common/decorators';
import {
  CreateEmployeeDto,
  EmployeeQueryDto,
  ImportEmployeesDto,
  UpdateEmployeeDto,
} from './employees.dto';
import { EmployeesService } from './employees.service';

@ApiTags('Employees')
@ApiBearerAuth()
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequirePermissions('employees:read')
  @ApiOperation({ summary: 'Search employees (scoped for supervisors)' })
  list(@Query() query: EmployeeQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.employees.list(query, user);
  }

  @Get(':id')
  @RequirePermissions('employees:read')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.employees.get(id, user);
  }

  @Post('import')
  @RequirePermissions('employees:write')
  @ApiOperation({
    summary: 'Create employees from the people on a terminal (see GET /devices/:id/people)',
    description:
      'Whoever already has that biometric ID is skipped (ALREADY_REGISTERED), as is a code ' +
      'already in use (CODE_IN_USE). Their cédula is filled in later.',
  })
  importPeople(
    @Body() dto: ImportEmployeesDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.employees.importPeople(dto, actor, ctx);
  }

  @Post()
  @RequirePermissions('employees:write')
  @ApiOperation({
    summary:
      'Register an employee. Previously unmatched punches with the same biometricId are linked.',
  })
  create(
    @Body() dto: CreateEmployeeDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.employees.create(dto, actor, ctx);
  }

  @Patch(':id')
  @RequirePermissions('employees:write')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.employees.update(id, dto, actor, ctx);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('employees:write')
  @ApiOperation({ summary: 'Soft delete: history is preserved, the linked account is disabled' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.employees.remove(id, actor, ctx);
  }
}
