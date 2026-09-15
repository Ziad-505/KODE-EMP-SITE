import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module';
import { MediaUrlModule } from '../media/media-url.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EntraService } from './entra.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';

@Module({
  imports: [JwtModule.register({}), AuditModule, MediaUrlModule],
  controllers: [AuthController],
  providers: [AuthService, TokenService, PasswordService, EntraService, TotpService],
  // JwtModule is re-exported because JwtAuthGuard is registered globally with
  // APP_GUARD, which instantiates it in the AppModule injector rather than
  // this one. Without the re-export, JwtService is unresolvable there and the
  // application fails to start.
  exports: [JwtModule, AuthService, TokenService, PasswordService, EntraService, TotpService],
})
export class AuthModule {}
