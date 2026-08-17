import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles/base.css';
import './styles/app.css';
import { ApiError } from './lib/api-client';
import { AuthProvider } from './lib/auth-context';
import { PortalLayout } from './components/layout';
import { RequireAuth } from './components/protected-route';
import { ScrollToTop } from './components/scroll-to-top';
import { HomePage } from './routes/home';
import { SignInPage } from './routes/sign-in';
import { ArticlePage, NewsPage } from './routes/news';
import { EventPage, EventsPage } from './routes/events';
import { PoliciesPage, PolicyPage } from './routes/policies';
import {
  AlbumPage,
  DirectoryPage,
  FaqsPage,
  GalleryPage,
  LinksPage,
  MorePage,
  NotFoundPage,
} from './routes/misc';
import { SupportPage } from './routes/support';
import { ProfilePage } from './routes/profile';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      // A 401 is handled by the API client's silent refresh; a 403 or 404 will
      // not improve on retry, so only retry genuine transport failures.
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status < 500) && failureCount < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ScrollToTop />
          <Routes>
            <Route path="/sign-in" element={<SignInPage />} />
            <Route
              element={
                <RequireAuth>
                  <PortalLayout />
                </RequireAuth>
              }
            >
              <Route path="/" element={<HomePage />} />
              <Route path="/news" element={<NewsPage />} />
              <Route path="/news/:slug" element={<ArticlePage />} />
              <Route path="/events" element={<EventsPage />} />
              <Route path="/events/:slug" element={<EventPage />} />
              <Route path="/policies" element={<PoliciesPage />} />
              <Route path="/policies/:slug" element={<PolicyPage />} />
              <Route path="/faqs" element={<FaqsPage />} />
              <Route path="/directory" element={<DirectoryPage />} />
              <Route path="/gallery" element={<GalleryPage />} />
              <Route path="/gallery/:slug" element={<AlbumPage />} />
              <Route path="/links" element={<LinksPage />} />
              <Route path="/support" element={<SupportPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/more" element={<MorePage />} />
              <Route path="/contacts" element={<Navigate to="/directory" replace />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
