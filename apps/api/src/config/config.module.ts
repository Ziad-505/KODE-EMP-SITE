import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { loadEnv, type Env } from './env';

export const ENV = 'ENV';

/**
 * Wraps @nestjs/config so the rest of the app injects a fully typed, already
 * validated `Env` object instead of calling `configService.get<string>(...)`
 * and hoping the key exists.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      validate: (raw) => loadEnv(raw as NodeJS.ProcessEnv),
    }),
  ],
  providers: [
    {
      provide: ENV,
      // `validate` above already proved process.env parses; this re-parses it
      // into the typed, transformed shape the rest of the app injects.
      useFactory: (): Env => loadEnv(process.env),
    },
  ],
  exports: [ENV],
})
export class ConfigModule {}
