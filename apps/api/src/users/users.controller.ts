import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ALL_PERMISSIONS,
  ALL_ROLES,
  Permission,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  ROLE_PERMISSIONS,
  ROLE_SCOPE,
  createUserSchema,
  departmentSchema,
  listUsersQuerySchema,
  updateProfileSchema,
  updateUserSchema,
  type CreateUserInput,
  type DepartmentDto,
  type DepartmentInput,
  type DirectoryEntryDto,
  type ListUsersQuery,
  type Page,
  type UpdateProfileInput,
  type UpdateUserInput,
  type UserDto,
} from '@kode/contracts';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermissions } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { UsersService } from './users.service';
import { DepartmentsService } from './departments.service';

@ApiTags('directory')
@Controller('directory')
export class DirectoryController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(Permission.DIRECTORY_READ)
  @ApiOperation({ summary: 'Employee directory (no role or account detail)' })
  list(
    @Query(ZodQuery(listUsersQuerySchema)) query: ListUsersQuery,
  ): Promise<Page<DirectoryEntryDto>> {
    return this.users.directory(query);
  }
}

@ApiTags('profile')
@Controller('profile')
export class ProfileController {
  constructor(private readonly users: UsersService) {}

  @Patch()
  @ApiOperation({ summary: 'Update your own profile' })
  update(
    @CurrentUser('id') id: string,
    @Body(ZodBody(updateProfileSchema)) input: UpdateProfileInput,
  ): Promise<UserDto> {
    return this.users.updateOwnProfile(id, input);
  }
}

@ApiTags('cms: people')
@Controller('cms/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(Permission.USER_READ)
  list(@Query(ZodQuery(listUsersQuerySchema)) query: ListUsersQuery): Promise<Page<UserDto>> {
    return this.users.list(query);
  }

  @Get('roles')
  @RequirePermissions(Permission.USER_READ)
  @ApiOperation({ summary: 'The role catalogue, with the permissions each grants' })
  roles() {
    return {
      roles: ALL_ROLES.map((role) => ({
        value: role,
        label: ROLE_LABEL[role],
        description: ROLE_DESCRIPTION[role],
        scope: ROLE_SCOPE[role],
        permissions: ROLE_PERMISSIONS[role],
      })),
      allPermissions: ALL_PERMISSIONS,
    };
  }

  @Get(':id')
  @RequirePermissions(Permission.USER_READ)
  findOne(@Param('id') id: string): Promise<UserDto> {
    return this.users.findOne(id);
  }

  @Post()
  @RequirePermissions(Permission.USER_CREATE)
  @ApiOperation({ summary: 'Create an account. Returns a temporary password if none was set.' })
  create(
    @Body(ZodBody(createUserSchema)) input: CreateUserInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<{ user: UserDto; temporaryPassword?: string }> {
    return this.users.create(input, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.USER_UPDATE)
  update(
    @Param('id') id: string,
    @Body(ZodBody(updateUserSchema)) input: UpdateUserInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<UserDto> {
    return this.users.update(id, input, actor);
  }

  @Post(':id/reset-password')
  @RequirePermissions(Permission.USER_UPDATE)
  @ApiOperation({ summary: 'Issue a temporary password and end that user’s sessions' })
  resetPassword(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<{ temporaryPassword: string }> {
    return this.users.resetPassword(id, actor);
  }

  @Delete(':id')
  @RequirePermissions(Permission.USER_DEACTIVATE)
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivate(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<void> {
    return this.users.deactivate(id, actor);
  }
}

@ApiTags('departments')
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @ApiOperation({ summary: 'All departments. Readable by any signed-in employee.' })
  list(): Promise<DepartmentDto[]> {
    return this.departments.list();
  }

  @Post()
  @RequirePermissions(Permission.DEPARTMENT_MANAGE)
  create(
    @Body(ZodBody(departmentSchema)) input: DepartmentInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DepartmentDto> {
    return this.departments.create(input, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.DEPARTMENT_MANAGE)
  update(
    @Param('id') id: string,
    @Body(ZodBody(departmentSchema)) input: DepartmentInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DepartmentDto> {
    return this.departments.update(id, input, actor);
  }

  @Delete(':id')
  @RequirePermissions(Permission.DEPARTMENT_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<void> {
    return this.departments.remove(id, actor);
  }
}
