import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
  userId: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const RequestContextStore = {
  run<T>(context: RequestContext, callback: () => T): T {
    return storage.run(context, callback);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
  /** Attach the authenticated user once the guard has resolved it. */
  setUserId(userId: string): void {
    const context = storage.getStore();
    if (context) context.userId = userId;
  },
};
