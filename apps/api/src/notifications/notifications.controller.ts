import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { CurrentUser } from '../common/decorators';
import { NotificationQueryDto } from './notifications.dto';
import { NotificationsService } from './notifications.service';

/**
 * The signed-in user's own notifications. No permission is required beyond being signed
 * in: every query is filtered by the caller, so nobody can read or mark someone else's.
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'My notifications, newest first' })
  list(@Query() query: NotificationQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notifications.list(query, user);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'How many of my notifications are unread (the bell badge)' })
  unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.unreadCount(user);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all my notifications as read' })
  readAll(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark one of my notifications as read (idempotent)' })
  @ApiNoContentResponse()
  async read(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.notifications.markRead(id, user);
  }
}
