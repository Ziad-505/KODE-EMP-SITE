import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { RequestContextStore } from './request-context';
import { fieldErrors } from './zod-validation.pipe';

interface NormalisedError {
  status: number;
  error: string;
  message: string;
  details?: Record<string, string[]>;
}

/**
 * The single place an error becomes an HTTP response. Guarantees:
 *  - one response shape for every failure, including framework errors;
 *  - a request id on every error so a user's screenshot maps to a log line;
 *  - no internal detail (stack, SQL, constraint names) leaves the process.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly isProduction: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const requestId = RequestContextStore.get()?.requestId ?? 'unknown';

    const normalised = this.normalise(exception);

    if (normalised.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `[${requestId}] ${normalised.message}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (
      normalised.status === HttpStatus.FORBIDDEN ||
      normalised.status === HttpStatus.UNAUTHORIZED
    ) {
      this.logger.warn(`[${requestId}] ${normalised.status} ${normalised.message}`);
    }

    response.status(normalised.status).json({
      statusCode: normalised.status,
      error: normalised.error,
      message: normalised.message,
      ...(normalised.details ? { details: normalised.details } : {}),
      requestId,
    });
  }

  private normalise(exception: unknown): NormalisedError {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        return { status, error: exception.name, message: body };
      }
      const record = body as Record<string, unknown>;
      const rawMessage = record.message;
      return {
        status,
        error: typeof record.error === 'string' ? record.error : exception.name,
        message: Array.isArray(rawMessage)
          ? rawMessage.join('; ')
          : typeof rawMessage === 'string'
            ? rawMessage
            : exception.message,
        ...(isDetails(record.details) ? { details: record.details } : {}),
      };
    }

    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'ValidationError',
        message: 'Validation failed',
        details: fieldErrors(exception),
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'InternalServerError',
      message: this.isProduction
        ? 'Something went wrong. Quote the request id when reporting this.'
        : exception instanceof Error
          ? exception.message
          : String(exception),
    };
  }

  private fromPrisma(error: Prisma.PrismaClientKnownRequestError): NormalisedError {
    switch (error.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: 'A record with these details already exists.',
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          error: 'NotFound',
          message: 'The requested record does not exist.',
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          error: 'BadRequest',
          message: 'A referenced record does not exist.',
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'DatabaseError',
          message: this.isProduction ? 'A database error occurred.' : `Prisma ${error.code}`,
        };
    }
  }
}

function isDetails(value: unknown): value is Record<string, string[]> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
