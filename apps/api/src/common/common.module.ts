import { Global, Module } from '@nestjs/common';
import { AccessScopeService } from './access/access-scope.service';

@Global()
@Module({
  providers: [AccessScopeService],
  exports: [AccessScopeService],
})
export class CommonModule {}
