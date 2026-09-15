import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { isTotpChallenge } from '@kode/contracts';
import type {
  LoginInput,
  LoginResponse,
  Permission,
  SessionUser,
  SignInResult,
} from '@kode/contracts';
import { ApiError, api, onSessionExpired } from './api-client';

interface AuthState {
  user: SessionUser | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  providers: { local: boolean; entra: boolean };
  /**
   * Resolves to `'done'` when a session was issued, or `'mfa'` when the account
   * carries a second factor and the caller must now collect a code and call
   * `completeTotp`. Returning a discriminator rather than throwing keeps the
   * two outcomes on the same footing: neither is an error.
   */
  signIn: (input: LoginInput) => Promise<'done' | 'mfa'>;
  completeTotp: (code: string) => Promise<void>;
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

  /*
   * The challenge token is held in a ref rather than state: it is a credential
   * in flight, it must not trigger a re-render, and it must not survive a
   * reload. It lives for the three minutes the API allows and no longer.
   */
  const challengeToken = useRef<string | null>(null);

  const signIn = useCallback(async (input: LoginInput): Promise<'done' | 'mfa'> => {
    const result = await api.post<SignInResult>('/auth/login', input);

    if (isTotpChallenge(result)) {
      challengeToken.current = result.challengeToken;
      return 'mfa';
    }

    challengeToken.current = null;
    setUser(result.user);
    setStatus('authenticated');
    return 'done';
  }, []);

  const completeTotp = useCallback(async (code: string) => {
    if (!challengeToken.current) {
      throw new ApiError(401, 'That sign-in attempt has expired. Please start again.');
    }
    const result = await api.post<LoginResponse>('/auth/login/totp', {
      challengeToken: challengeToken.current,
      code,
    });
    challengeToken.current = null;
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
      completeTotp,
      signOut,
      refresh: load,
      can: (permission) => user?.permissions.includes(permission) ?? false,
    }),
    [user, status, providers, signIn, completeTotp, signOut, load],
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
