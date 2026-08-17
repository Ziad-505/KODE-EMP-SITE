import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { MediaUrlModule } from '../media/media-url.module';
import { UsersService } from './users.service';
import { DepartmentsService } from './departments.service';
import {
  DepartmentsController,
  DirectoryController,
  ProfileController,
  UsersController,
} from './users.controller';

@Module({
  imports: [AuditModule, AuthModule, MediaUrlModule],
  controllers: [UsersController, DirectoryController, ProfileController, DepartmentsController],
  providers: [UsersService, DepartmentsService],
  exports: [UsersService],
})
export class UsersModule {}
