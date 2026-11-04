import type { ApiErrorCode, ApiErrorParams } from '@asistcontrol/shared';

/**
 * The body of an HttpException with its code: `new ConflictException(apiError('X', 'English'))`.
 * The compiler asks for the params exactly when the code has them; a lint rule refuses
 * exceptions without a code, so a new error cannot reach people as untranslatable text.
 */
export function apiError<C extends ApiErrorCode>(
  code: C,
  message: string | string[],
  ...[params]: ApiErrorParams[C] extends undefined ? [] : [ApiErrorParams[C]]
): { code: C; message: string | string[]; params?: ApiErrorParams[C] } {
  return params === undefined ? { code, message } : { code, message, params };
}
