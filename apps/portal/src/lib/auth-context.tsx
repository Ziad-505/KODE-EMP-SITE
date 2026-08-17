import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { LoginInput, LoginResponse, Permission, SessionUser } from '@kode/contracts';
import { ApiError, api, onSessionExpired } from './api-client';

interface AuthState {
  user: SessionUser | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  providers: { local: boolean; entra: boolean };
  signIn: (input: LoginInput) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [providers, setProviders] = useState({ local: true, entra: false });

  const load = useCallback(async () => {
    try {
      const me = await api.get<SessionUser>('/auth/me');
      setUser(me);
      setStatus('authenticated');
    } catch (error) {
      if (error instanceof ApiError && (error.isAuthError || error.isForbidden)) {
        setUser(null);
        setStatus('anonymous');
        return;
      }
      // A network or server failure is not proof of being signed out; stay
      // anonymous but do not clear a session we cannot confirm is gone.
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    void load();
    void api
      .get<{ local: boolean; entra: boolean }>('/auth/providers')
      .then(setProviders)
      .catch(() => undefined);
  }, [load]);

  // The API client fires this when a silent refresh fails.
  useEffect(
    () =>
      onSessionExpired(() => {
        setUser(null);
        setStatus('anonymous');
      }),
    [],
  );

  const signIn = useCallback(async (input: LoginInput) => {
    const result = await api.post<LoginResponse>('/auth/login', input);
    setUser(result.user);
    setStatus('authenticated');
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post<void>('/auth/logout');
    } finally {
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      status,
      providers,
      signIn,
      signOut,
      refresh: load,
      can: (permission) => user?.permissions.includes(permission) ?? false,
    }),
    [user, status, providers, signIn, signOut, load],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}

/** Non-throwing variant for components rendered outside the provider in tests. */
export function useSessionUser(): SessionUser | null {
  return useContext(AuthContext)?.user ?? null;
}
