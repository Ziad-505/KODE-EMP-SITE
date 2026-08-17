import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { RequestContextStore } from './request-context';

/**
 * Establishes a per-request async context so services deep in the call stack
 * can write correct audit rows without every method taking `req` as a
 * parameter.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const headerId = req.header('x-request-id');
    const requestId = headerId && /^[\w-]{1,64}$/.test(headerId) ? headerId : randomUUID();
    res.setHeader('x-request-id', requestId);

    RequestContextStore.run(
      {
        requestId,
        ipAddress: req.ip ?? null,
        userAgent: req.header('user-agent')?.slice(0, 300) ?? null,
        userId: null,
      },
      () => next(),
    );
  }
}
