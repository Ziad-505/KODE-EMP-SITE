import { StrictMode, Suspense, lazy } from 'react';
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
import { PageSkeleton } from './components/states';

/*
 * The shell, the sign-in screen and the home page load eagerly, because one of
 * those three is always the first thing rendered and splitting them would only
 * add a round trip to the critical path.
 *
 * Everything else is split. The whole application used to arrive as a single
 * bundle, so a phone on mobile data downloaded the gallery lightbox, the staff
 * directory and the IT request form before it could paint the home page — and
 * paid for screens the reader may never open.
 */
import { HomePage } from './routes/home';
import { SignInPage } from './routes/sign-in';

const NewsPage = lazy(() => import('./routes/news').then((m) => ({ default: m.NewsPage })));
const ArticlePage = lazy(() => import('./routes/news').then((m) => ({ default: m.ArticlePage })));
const EventsPage = lazy(() => import('./routes/events').then((m) => ({ default: m.EventsPage })));
const EventPage = lazy(() => import('./routes/events').then((m) => ({ default: m.EventPage })));
const PoliciesPage = lazy(() =>
  import('./routes/policies').then((m) => ({ default: m.PoliciesPage })),
);
const PolicyPage = lazy(() => import('./routes/policies').then((m) => ({ default: m.PolicyPage })));
const FaqsPage = lazy(() => import('./routes/misc').then((m) => ({ default: m.FaqsPage })));
const DirectoryPage = lazy(() =>
  import('./routes/misc').then((m) => ({ default: m.DirectoryPage })),
);
const GalleryPage = lazy(() => import('./routes/misc').then((m) => ({ default: m.GalleryPage })));
const AlbumPage = lazy(() => import('./routes/misc').then((m) => ({ default: m.AlbumPage })));
const LinksPage = lazy(() => import('./routes/misc').then((m) => ({ default: m.LinksPage })));
const MorePage = lazy(() => import('./routes/misc').then((m) => ({ default: m.MorePage })));
const NotFoundPage = lazy(() => import('./routes/misc').then((m) => ({ default: m.NotFoundPage })));
const SupportPage = lazy(() =>
  import('./routes/support').then((m) => ({ default: m.SupportPage })),
);
const ProfilePage = lazy(() =>
  import('./routes/profile').then((m) => ({ default: m.ProfilePage })),
);

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
          {/* One boundary around the whole tree: a split chunk arrives in a few
              milliseconds on a warm connection, and a per-route boundary would
              flash a different skeleton on every navigation. */}
          <Suspense fallback={<PageSkeleton />}>
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
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
