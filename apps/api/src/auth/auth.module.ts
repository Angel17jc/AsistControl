import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordLinksService } from './password-links.service';
import { PasswordService } from './password.service';

@Global()
@Module({
  // Secrets are passed per call (access vs refresh), so no default secret is registered.
  imports: [JwtModule.register({ global: true }), MailModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, PasswordLinksService],
  exports: [PasswordService, PasswordLinksService],
})
export class AuthModule {}
