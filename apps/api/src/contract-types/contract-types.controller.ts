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
import { CreateContractTypeDto, UpdateContractTypeDto } from './contract-types.dto';
import { ContractTypesService } from './contract-types.service';

@ApiTags('Contract types')
@ApiBearerAuth()
@Controller('contract-types')
export class ContractTypesController {
  constructor(private readonly contractTypes: ContractTypesService) {}

  @Get()
  @RequirePermissions('organization:read')
  @ApiOperation({ summary: 'Contract types with their vacation rules and how many use them' })
  list() {
    return this.contractTypes.list();
  }

  @Get(':id')
  @RequirePermissions('organization:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.contractTypes.get(id);
  }

  @Post()
  @RequirePermissions('organization:write')
  create(
    @Body() dto: CreateContractTypeDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.contractTypes.create(dto, actor, ctx);
  }

  @Patch(':id')
  @RequirePermissions('organization:write')
  @ApiOperation({
    summary: 'Change the rules; balances are recomputed from them, nothing is stored',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContractTypeDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.contractTypes.update(id, dto, actor, ctx);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('organization:write')
  @ApiOperation({ summary: 'Delete an unused contract type (409 while employees use it)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.contractTypes.remove(id, actor, ctx);
  }
}
