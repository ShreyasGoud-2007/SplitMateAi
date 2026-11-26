import type { Session, User } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { getSupabaseClient } from '@/utils/supabase';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  initializationError: string | null;
  signOut: () => Promise<void>;
}

interface AuthSnapshot {
  status: AuthStatus;
  user: User | null;
  initializationError: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function statusFromSession(session: Session | null): AuthStatus {
  return session?.user ? 'authenticated' : 'unauthenticated';
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>({
    status: 'loading',
    user: null,
    initializationError: null,
  });

  useEffect(() => {
    let active = true;
    let authEventReceived = false;
    let subscription: { unsubscribe: () => void } | undefined;

    void Promise.resolve()
      .then(() => {
        if (!active) return null;
        return getSupabaseClient();
      })
      .then((client) => {
        if (!client || !active) return null;
        const authListener = client.auth.onAuthStateChange((_event, session) => {
          authEventReceived = true;
          if (!active) return;
          setSnapshot({
            status: statusFromSession(session),
            user: session?.user ?? null,
            initializationError: null,
          });
        });
        subscription = authListener.data.subscription;
        return client.auth.getSession();
      })
      .then((result) => {
        if (!result || !active || authEventReceived) return;
        if (result.error) {
          setSnapshot({
            status: 'unauthenticated',
            user: null,
            initializationError: result.error.message,
          });
          return;
        }
        setSnapshot({
          status: statusFromSession(result.data.session),
          user: result.data.session?.user ?? null,
          initializationError: null,
        });
      })
      .catch((error: unknown) => {
        if (!active || authEventReceived) return;
        setSnapshot({
          status: 'unauthenticated',
          user: null,
          initializationError:
            error instanceof Error ? error.message : 'Could not restore your sign-in session.',
        });
      });

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    const client = getSupabaseClient();
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) throw error;
  }, []);

  const value = useMemo(
    () => ({ ...snapshot, signOut }),
    [snapshot, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
