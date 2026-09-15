import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminListQuery,
  AlbumDto,
  ArticleDto,
  AuditEntryDto,
  CmsDashboardDto,
  ContentStatus,
  CreateUserInput,
  DepartmentDto,
  EventDto,
  FaqDto,
  ListAuditQuery,
  ListMediaQuery,
  ListUsersQuery,
  MediaDto,
  MediaLimitsDto,
  Page,
  Permission,
  PolicyDto,
  QuickLinkDto,
  TaxonomyDto,
  TaxonomyKind,
  CreateTaxonomyInput,
  UpdateTaxonomyInput,
  Role,
  Scope,
  UpdateUserInput,
  UserDto,
} from '@kode/contracts';
import { api } from './api-client';

/**
 * Every content type the CMS manages shares the same REST shape, so one
 * descriptor per resource replaces six near-identical hook files.
 */
export interface ResourceDefinition {
  key: string;
  path: string;
  /** Sidebar and page labels. `singular` is explicit, never derived by slicing
   *  the plural, which is how the original produced "NEW POLICIE". */
  singular: string;
  plural: string;
  icon: string;
  permissions: {
    read: Permission;
    create: Permission;
    update: Permission;
    remove: Permission;
    publish: Permission;
  };
}

export type ContentDto = ArticleDto | EventDto | PolicyDto | FaqDto | AlbumDto;

export const dashboardKey = ['cms', 'dashboard'] as const;

export const useDashboard = () =>
  useQuery({ queryKey: dashboardKey, queryFn: () => api.get<CmsDashboardDto>('/cms/dashboard') });

export const useDepartments = () =>
  useQuery({
    queryKey: ['cms', 'departments'],
    queryFn: () => api.get<DepartmentDto[]>('/departments'),
  });

/**
 * The authoritative upload limit, from the server.
 *
 * The UI used to hardcode 15 MB from the contracts package while the server
 * read `MAX_UPLOAD_MB`, so raising the server limit did nothing: the browser
 * refused the file before it was ever sent.
 */
export const useMediaLimits = () =>
  useQuery({
    queryKey: ['cms', 'media', 'limits'],
    queryFn: () => api.get<MediaLimitsDto>('/media/limits'),
    staleTime: 30 * 60_000,
  });

/* ------------------------------------------------------- admin-managed terms */

export const taxonomyKey = ['cms', 'taxonomy'] as const;

/**
 * Terms are read by every editor, not just Super Admins, because the create
 * form needs the labels. Writes are refused by the API without
 * `settings:manage`, so the read being open costs nothing.
 */
export const useTaxonomy = (kind?: TaxonomyKind, includeArchived = false) =>
  useQuery({
    queryKey: [...taxonomyKey, kind ?? 'all', includeArchived],
    queryFn: () =>
      api.get<TaxonomyDto[]>('/taxonomy', {
        ...(kind ? { kind } : {}),
        ...(includeArchived ? { includeArchived: true } : {}),
      }),
    // These change rarely and are read on nearly every screen.
    staleTime: 5 * 60_000,
  });

export function useTaxonomyMutations() {
  const client = useQueryClient();
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: taxonomyKey });
    /*
     * Content rows embed the term's label and colour, so a rename has to
     * invalidate the content lists too or the CMS shows the old name until
     * reload — which reads as the rename having silently failed.
     *
     * All four namespaces now embed the term, not just events, so this
     * invalidates the whole `cms` prefix rather than naming one resource. It
     * refetches a few lists that did not need it; the alternative is a list of
     * keys that has to be extended every time a namespace is added, and the
     * events-only version is exactly that omission.
     */
    void client.invalidateQueries({ queryKey: ['cms'] });
  };

  return {
    create: useMutation({
      mutationFn: (input: CreateTaxonomyInput) => api.post<TaxonomyDto>('/taxonomy', input),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpdateTaxonomyInput }) =>
        api.patch<TaxonomyDto>(`/taxonomy/${id}`, input),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.delete<void>(`/taxonomy/${id}`),
      onSuccess: invalidate,
    }),
  };
}

export function useContentList<T>(resource: ResourceDefinition, query: AdminListQuery) {
  return useQuery({
    queryKey: ['cms', resource.key, query],
    queryFn: () => api.get<Page<T>>(resource.path, query as unknown as Record<string, string>),
    placeholderData: (previous) => previous,
  });
}

export function useContentItem<T>(resource: ResourceDefinition, id: string | undefined) {
  return useQuery({
    queryKey: ['cms', resource.key, 'item', id],
    queryFn: () => api.get<T>(`${resource.path}/${id}`),
    enabled: Boolean(id),
  });
}

export function useSaveContent<T>(resource: ResourceDefinition) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: unknown }) =>
      id ? api.patch<T>(`${resource.path}/${id}`, input) : api.post<T>(resource.path, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['cms', resource.key] });
      void client.invalidateQueries({ queryKey: dashboardKey });
    },
  });
}

export function useChangeStatus<T>(resource: ResourceDefinition) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: ContentStatus; note?: string }) =>
      api.post<T>(`${resource.path}/${id}/status`, { status, ...(note ? { note } : {}) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['cms', resource.key] });
      void client.invalidateQueries({ queryKey: dashboardKey });
    },
  });
}

export function useDeleteContent(resource: ResourceDefinition) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`${resource.path}/${id}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['cms', resource.key] });
      void client.invalidateQueries({ queryKey: dashboardKey });
    },
  });
}

/* --------------------------------------------------------------------- media */

export const useMedia = (query: ListMediaQuery) =>
  useQuery({
    queryKey: ['cms', 'media', query],
    queryFn: () => api.get<Page<MediaDto>>('/media', query as unknown as Record<string, string>),
    placeholderData: (previous) => previous,
  });

export function useUploadMedia() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.upload<MediaDto>('/media', form);
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['cms', 'media'] }),
  });
}

export function useDeleteMedia() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/media/item/${id}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['cms', 'media'] }),
  });
}

/* --------------------------------------------------------------------- links */

export const useQuickLinks = () =>
  useQuery({ queryKey: ['cms', 'links'], queryFn: () => api.get<QuickLinkDto[]>('/cms/links') });

/* -------------------------------------------------------------------- people */

export interface RoleCatalogue {
  roles: {
    value: Role;
    label: string;
    description: string;
    scope: Scope;
    permissions: Permission[];
  }[];
  allPermissions: Permission[];
}

export const useRoleCatalogue = () =>
  useQuery({
    queryKey: ['cms', 'roles'],
    queryFn: () => api.get<RoleCatalogue>('/cms/users/roles'),
  });

export const useUsers = (query: ListUsersQuery) =>
  useQuery({
    queryKey: ['cms', 'users', query],
    queryFn: () => api.get<Page<UserDto>>('/cms/users', query as unknown as Record<string, string>),
    placeholderData: (previous) => previous,
  });

export function useCreateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) =>
      api.post<{ user: UserDto; temporaryPassword?: string }>('/cms/users', input),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['cms', 'users'] }),
  });
}

export function useUpdateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserInput }) =>
      api.patch<UserDto>(`/cms/users/${id}`, input),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['cms', 'users'] }),
  });
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ temporaryPassword: string }>(`/cms/users/${id}/reset-password`),
  });
}

export function useDeactivateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/cms/users/${id}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['cms', 'users'] }),
  });
}

/* --------------------------------------------------------------------- audit */

export const useAudit = (query: ListAuditQuery) =>
  useQuery({
    queryKey: ['cms', 'audit', query],
    queryFn: () =>
      api.get<Page<AuditEntryDto>>('/audit', query as unknown as Record<string, string>),
    placeholderData: (previous) => previous,
  });
