import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { NotificationEmailDispatcher } from './email/notification-email.dispatcher';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [MailModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationEmailDispatcher],
  exports: [NotificationsService],
})
export class NotificationsModule {}
