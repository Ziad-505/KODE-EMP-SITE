import {
  Injectable,
  type ArgumentMetadata,
  type PipeTransform,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ZodError, type ZodTypeAny, type infer as ZodInfer } from 'zod';

/**
 * Turns a Zod schema into a Nest pipe.
 *
 * Validation lives in @kode/contracts and is shared verbatim with both
 * frontends, so a field constraint can never drift between the form and the
 * endpoint that receives it.
 *
 * Usage:
 *   @Body(new ZodBody(createArticleSchema)) input: CreateArticleInput
 */
@Injectable()
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown, _metadata: ArgumentMetadata): ZodInfer<T> {
    try {
      return this.schema.parse(value) as ZodInfer<T>;
    } catch (error) {
      if (error instanceof ZodError) {
        throw new UnprocessableEntityException({
          message: 'Validation failed',
          details: fieldErrors(error),
        });
      }
      throw error;
    }
  }
}

export function ZodBody<T extends ZodTypeAny>(schema: T): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}

export function ZodQuery<T extends ZodTypeAny>(schema: T): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}

export function fieldErrors(error: ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    (result[key] ??= []).push(issue.message);
  }
  return result;
}
