import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { tap } from 'rxjs';
import { RequestContextStore } from './request-context';

/** One structured line per request. Slow requests are promoted to a warning. */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');
  private static readonly SLOW_MS = 1_000;

  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const startedAt = process.hrtime.bigint();

    return next.handle().pipe(
      tap({
        next: () => this.write(request, response.statusCode, startedAt),
        error: (error: unknown) => {
          const status =
            typeof error === 'object' && error !== null && 'status' in error
              ? Number((error as { status: unknown }).status)
              : 500;
          this.write(request, status, startedAt);
        },
      }),
    );
  }

  private write(request: Request, status: number, startedAt: bigint): void {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const context = RequestContextStore.get();
    const line = `${request.method} ${request.originalUrl} ${status} ${ms.toFixed(1)}ms [${context?.requestId ?? '-'}]${
      context?.userId ? ` user=${context.userId}` : ''
    }`;
    if (ms > LoggingInterceptor.SLOW_MS) this.logger.warn(`SLOW ${line}`);
    else this.logger.log(line);
  }
}
