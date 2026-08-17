import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Permission } from '@kode/contracts';
import './styles/base.css';
import { ApiError } from './lib/api-client';
import { AuthProvider } from './lib/auth-context';
import { AdminShell } from './components/shell';
import { RequireCms } from './components/require-cms';
import { CmsSignInPage } from './routes/sign-in';
import { DashboardPage } from './routes/dashboard';
import { ContentListPage } from './routes/content-list';
import { ContentEditorPage } from './routes/content-editor';
import { MediaPage } from './routes/media';
import { PeoplePage } from './routes/people';
import { AuditPage } from './routes/audit';
import { TaxonomyPage } from './routes/taxonomy';
import { AccessPage } from './routes/access';
import { LinksPage } from './routes/links';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
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
          <Routes>
            <Route path="/sign-in" element={<CmsSignInPage />} />
            <Route
              element={
                <RequireCms permission={Permission.CMS_ACCESS}>
                  <AdminShell />
                </RequireCms>
              }
            >
              <Route path="/" element={<DashboardPage />} />
              <Route path="/content/:resourceKey" element={<ContentListPage />} />
              <Route path="/content/:resourceKey/:id" element={<ContentEditorPage />} />
              <Route
                path="/links"
                element={
                  <RequireCms permission={Permission.LINK_READ}>
                    <LinksPage />
                  </RequireCms>
                }
              />
              <Route
                path="/media"
                element={
                  <RequireCms permission={Permission.MEDIA_READ}>
                    <MediaPage />
                  </RequireCms>
                }
              />
              <Route
                path="/people"
                element={
                  <RequireCms permission={Permission.USER_READ}>
                    <PeoplePage />
                  </RequireCms>
                }
              />
              <Route
                path="/audit"
                element={
                  <RequireCms permission={Permission.AUDIT_READ}>
                    <AuditPage />
                  </RequireCms>
                }
              />
              <Route
                path="/access"
                element={
                  <RequireCms permission={Permission.SETTINGS_MANAGE}>
                    <AccessPage />
                  </RequireCms>
                }
              />
              <Route
                path="/lists"
                element={
                  <RequireCms permission={Permission.CMS_ACCESS}>
                    <TaxonomyPage />
                  </RequireCms>
                }
              />
              <Route path="*" element={<DashboardPage />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
