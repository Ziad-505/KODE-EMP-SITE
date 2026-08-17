import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AlbumDto,
  ArticleDto,
  CreateTicketInput,
  DirectoryEntryDto,
  EventDto,
  FaqDto,
  ListTicketsQuery,
  Page,
  PolicyDto,
  PortalHomeDto,
  QuickLinkDto,
  SearchResultDto,
  TicketDto,
} from '@kode/contracts';
import { api } from './api-client';

/**
 * Query keys are centralised so an invalidation after a mutation cannot miss a
 * cache entry because two files spelled the key differently.
 */
export const keys = {
  home: ['portal', 'home'] as const,
  news: (page: number, q: string) => ['portal', 'news', page, q] as const,
  article: (slug: string) => ['portal', 'news', slug] as const,
  events: (page: number, q: string) => ['portal', 'events', page, q] as const,
  event: (slug: string) => ['portal', 'events', slug] as const,
  policies: (page: number, q: string) => ['portal', 'policies', page, q] as const,
  policy: (slug: string) => ['portal', 'policies', slug] as const,
  faqs: (q: string) => ['portal', 'faqs', q] as const,
  gallery: (page: number) => ['portal', 'gallery', page] as const,
  album: (slug: string) => ['portal', 'gallery', slug] as const,
  links: ['portal', 'links'] as const,
  directory: (page: number, q: string) => ['portal', 'directory', page, q] as const,
  tickets: (query: ListTicketsQuery) => ['portal', 'tickets', query] as const,
  search: (q: string) => ['portal', 'search', q] as const,
};

const PAGE_SIZE = 12;

export const useHome = () =>
  useQuery({ queryKey: keys.home, queryFn: () => api.get<PortalHomeDto>('/portal/home') });

export const useNews = (page: number, q: string) =>
  useQuery({
    queryKey: keys.news(page, q),
    queryFn: () => api.get<Page<ArticleDto>>('/portal/news', { page, pageSize: PAGE_SIZE, q }),
    placeholderData: (previous) => previous,
  });

export const useArticle = (slug: string) =>
  useQuery({
    queryKey: keys.article(slug),
    queryFn: () => api.get<ArticleDto>(`/portal/news/${slug}`),
  });

export const useEvents = (page: number, q: string) =>
  useQuery({
    queryKey: keys.events(page, q),
    queryFn: () => api.get<Page<EventDto>>('/portal/events', { page, pageSize: PAGE_SIZE, q }),
    placeholderData: (previous) => previous,
  });

export const useEvent = (slug: string) =>
  useQuery({
    queryKey: keys.event(slug),
    queryFn: () => api.get<EventDto>(`/portal/events/${slug}`),
  });

export const usePolicies = (page: number, q: string) =>
  useQuery({
    queryKey: keys.policies(page, q),
    queryFn: () => api.get<Page<PolicyDto>>('/portal/policies', { page, pageSize: PAGE_SIZE, q }),
    placeholderData: (previous) => previous,
  });

export const usePolicy = (slug: string) =>
  useQuery({
    queryKey: keys.policy(slug),
    queryFn: () => api.get<PolicyDto>(`/portal/policies/${slug}`),
  });

export const useFaqs = (q: string) =>
  useQuery({
    queryKey: keys.faqs(q),
    queryFn: () => api.get<Page<FaqDto>>('/portal/faqs', { page: 1, pageSize: 100, q }),
  });

export const useGallery = (page: number) =>
  useQuery({
    queryKey: keys.gallery(page),
    queryFn: () => api.get<Page<AlbumDto>>('/portal/gallery', { page, pageSize: PAGE_SIZE }),
    placeholderData: (previous) => previous,
  });

export const useAlbum = (slug: string) =>
  useQuery({
    queryKey: keys.album(slug),
    queryFn: () => api.get<AlbumDto>(`/portal/gallery/${slug}`),
  });

export const useLinks = () =>
  useQuery({ queryKey: keys.links, queryFn: () => api.get<QuickLinkDto[]>('/portal/links') });

export const useDirectory = (page: number, q: string) =>
  useQuery({
    queryKey: keys.directory(page, q),
    queryFn: () => api.get<Page<DirectoryEntryDto>>('/directory', { page, pageSize: 24, q }),
    placeholderData: (previous) => previous,
  });

export const useMyTickets = () =>
  useQuery({
    queryKey: keys.tickets({ page: 1, pageSize: 20, mine: true }),
    queryFn: () =>
      api.get<Page<TicketDto>>('/support/tickets', { page: 1, pageSize: 20, mine: true }),
  });

export function useSearch(term: string) {
  return useQuery({
    queryKey: keys.search(term),
    queryFn: () => api.get<SearchResultDto[]>('/portal/search', { q: term, limit: 12 }),
    enabled: term.trim().length >= 2,
    staleTime: 30_000,
  });
}

export function useCreateTicket() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTicketInput) => api.post<TicketDto>('/support/tickets', input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['portal', 'tickets'] });
    },
  });
}
