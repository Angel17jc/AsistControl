import {
  BadRequestException,
  type HttpException,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common';
import type { ApiViolation } from '@asistcontrol/shared';
import { apiError } from './api-error';

/** A large payload can break many rules; a client only needs the first ones to explain it. */
const MAX_VIOLATIONS = 50;

/**
 * ValidationPipe that also says which rule of which field failed, so a client can word it.
 * It wraps the pipe's own factory instead of replacing it, to keep its English messages and
 * the limit it puts on their size.
 */
export class CodedValidationPipe extends ValidationPipe {
  override createExceptionFactory() {
    const base = super.createExceptionFactory();
    return (errors: ValidationError[] = []) => {
      const response = (base(errors) as HttpException).getResponse() as {
        message: string | string[];
      };
      return new BadRequestException(
        apiError('VALIDATION_FAILED', response.message, {
          violations: violationsOf(errors).slice(0, MAX_VIOLATIONS),
        }),
      );
    };
  }
}

function violationsOf(errors: ValidationError[], parent = ''): ApiViolation[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.keys(error.constraints ?? {}).map((rule) => ({ field, rule }));
    return [...own, ...violationsOf(error.children ?? [], field)];
  });
}
