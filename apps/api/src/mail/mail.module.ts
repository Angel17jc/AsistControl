import { Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { LinkMailer } from './link-mailer';
import { MAIL_TRANSPORT, type MailTransport, SmtpMailTransport } from './mail-transport';

@Module({
  providers: [
    LinkMailer,
    {
      provide: MAIL_TRANSPORT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): MailTransport | null => {
        const url = config.get('SMTP_URL');
        if (!url) return null;
        // validateEnv guarantees MAIL_FROM whenever SMTP_URL is set.
        return new SmtpMailTransport({
          url,
          from: config.get('MAIL_FROM')!,
          requireTls: config.isProduction,
        });
      },
    },
  ],
  exports: [MAIL_TRANSPORT, LinkMailer],
})
export class MailModule {}
