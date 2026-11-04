import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApiErrorCode, ApiErrorResponse } from '@asistcontrol/shared';
import type { Request, Response } from 'express';
import { apiError } from '../errors/api-error';

/**
 * Single error contract for the whole API. Unknown errors are logged with full detail
 * server-side but returned to the client as a generic 500 — no stack traces, SQL or internals.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') return;
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();

    const { status, ...error } = this.resolve(exception);
    if (status >= 500) {
      this.logger.error({ err: exception, path: req.url, requestId: req.id }, 'Unhandled error');
    }

    const body: ApiErrorResponse = {
      statusCode: status,
      error: HttpStatus[status] ?? 'Error',
      ...error,
      path: req.url,
      timestamp: new Date().toISOString(),
      requestId: req.id ? String(req.id) : undefined,
    };
    res.status(status).json(body);
  }

  private resolve(exception: unknown): Resolved {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'string') {
        return { status, code: codeForStatus(status), message: response };
      }
      const { code, params, message } = response as Partial<ApiErrorResponse>;
      return {
        status,
        code: code ?? codeForStatus(status),
        ...(params === undefined ? {} : { params }),
        message: message ?? exception.message,
      };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002': {
          // Column names, or the constraint's name as a string on some connectors.
          const target = exception.meta?.target;
          const columns: string[] = Array.isArray(target) ? target : [];
          return {
            status: HttpStatus.CONFLICT,
            ...apiError(
              'DUPLICATE_RECORD',
              columns.length > 0
                ? `A record with the same ${columns.join(', ')} already exists`
                : 'Duplicate record',
              { fields: columns.map(toPropertyName) },
            ),
          };
        }
        case 'P2025':
          return {
            status: HttpStatus.NOT_FOUND,
            ...apiError('NOT_FOUND', 'Resource not found'),
          };
        case 'P2003':
          return {
            status: HttpStatus.CONFLICT,
            ...apiError('RECORD_IN_USE', 'Related resource does not exist or is in use'),
          };
      }
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      ...apiError('INTERNAL_ERROR', 'Internal server error'),
    };
  }
}

type Resolved = Pick<ApiErrorResponse, 'code' | 'params' | 'message'> & { status: number };

/** employee_code → employeeCode: clients know the API's properties, not its columns. */
function toPropertyName(column: string): string {
  return column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** For what comes without a code of its own: a route that does not exist, the rate limiter… */
function codeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'BAD_REQUEST';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'TOO_MANY_REQUESTS';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED';
  }
}
