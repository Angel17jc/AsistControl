import { Logger } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { REALTIME_NAMESPACE, hasPermission } from '@asistcontrol/shared';
import type { Server, Socket } from 'socket.io';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AppConfigService } from '../config/app-config.service';

export const ROOMS = {
  /** Unrestricted dashboard viewers (ADMIN, HR…). */
  ALL_ATTENDANCE: 'attendance:all',
  DEVICES: 'devices',
  supervisor: (employeeId: string) => `attendance:supervisor:${employeeId}`,
  employee: (employeeId: string) => `attendance:employee:${employeeId}`,
  /** Every socket of one user: what is addressed to that person only (notifications). */
  user: (userId: string) => `user:${userId}`,
} as const;

/**
 * Authenticates sockets with the same access token as the REST API and places each client
 * in rooms matching what it is allowed to see. Emission is done by RealtimeService.
 */
@WebSocketGateway({ namespace: REALTIME_NAMESPACE, cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly auth: JwtAuthGuard,
    private readonly config: AppConfigService,
  ) {}

  afterInit(server: Server): void {
    // Namespace-level CORS is configured on the underlying engine; restrict origins here.
    const allowed = new Set(this.config.get('CORS_ORIGINS'));
    server.use((socket, next) => {
      const origin = socket.handshake.headers.origin;
      if (origin && !allowed.has(origin)) return next(new Error('Origin not allowed'));
      next();
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = (client.handshake.auth as { token?: string } | undefined)?.token;
      if (!token) throw new Error('missing token');
      const user = await this.auth.verify(token);
      client.data.user = user;
      await client.join(ROOMS.user(user.id));

      if (hasPermission(user.role, 'devices:read')) await client.join(ROOMS.DEVICES);
      if (['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user.role)) {
        await client.join(ROOMS.ALL_ATTENDANCE);
      } else if (user.employeeId) {
        await client.join(ROOMS.employee(user.employeeId));
        if (user.role === 'SUPERVISOR') await client.join(ROOMS.supervisor(user.employeeId));
      }
    } catch {
      this.logger.debug(`Rejected socket ${client.id}: unauthenticated`);
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }
}
