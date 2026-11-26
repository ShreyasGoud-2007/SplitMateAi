import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { authStorage } from '@/utils/authStorage';

let client: SupabaseClient | null = null;

export class SupabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupabaseConfigurationError';
  }
}

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    throw new SupabaseConfigurationError(
      'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in the root .env file.',
    );
  }

  try {
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: authStorage,
      },
    });
  } catch (error) {
    throw new SupabaseConfigurationError(
      `Supabase configuration is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return client;
}

export function resetSupabaseClientForTests(): void {
  client = null;
}
