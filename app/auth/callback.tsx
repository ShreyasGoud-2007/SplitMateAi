import { Colors } from '@/constants/Colors';
import { useAuth } from '@/store/authStore';
import { getSupabaseClient } from '@/utils/supabase';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CheckCircle2, CircleAlert, Sparkles } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type CallbackState = 'loading' | 'success' | 'error';

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{
    code?: string | string[];
    token_hash?: string | string[];
    type?: string | string[];
    access_token?: string | string[];
    refresh_token?: string | string[];
    error_description?: string | string[];
  }>();
  const router = useRouter();
  const { status } = useAuth();
  const processed = useRef(false);
  const routedToApp = useRef(false);
  const [state, setState] = useState<CallbackState>('loading');
  const [message, setMessage] = useState('Verifying your email…');

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    async function verifyLink() {
      try {
        const errorDescription = firstParam(params.error_description);
        if (errorDescription) throw new Error(decodeURIComponent(errorDescription.replace(/\+/g, ' ')));

        const client = getSupabaseClient();
        const code = firstParam(params.code);
        const tokenHash = firstParam(params.token_hash);
        const tokenType = firstParam(params.type);
        const accessToken = firstParam(params.access_token);
        const refreshToken = firstParam(params.refresh_token);

        if (code) {
          const { error } = await client.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (tokenHash && tokenType &&
          ['signup', 'email', 'email_change', 'recovery', 'invite', 'magiclink'].includes(tokenType)) {
          const { error } = await client.auth.verifyOtp({
            token_hash: tokenHash,
            type: tokenType as 'signup' | 'email' | 'email_change' | 'recovery' | 'invite' | 'magiclink',
          });
          if (error) throw error;
        } else if (accessToken && refreshToken) {
          const { error } = await client.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        } else {
          throw new Error('This verification link is incomplete or has expired. Request a new one and try again.');
        }

        setMessage('Email verified. You can now use SplitMate AI.');
        setState('success');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Could not verify this email link.');
        setState('error');
      }
    }

    void verifyLink();
  }, [params]);

  useEffect(() => {
    if (state === 'success' && status === 'authenticated' && !routedToApp.current) {
      routedToApp.current = true;
      router.replace('/');
    }
  }, [router, state, status]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <View style={styles.icon}>
          {state === 'loading' ? (
            <Sparkles size={25} color={Colors.white} />
          ) : state === 'success' ? (
            <CheckCircle2 size={26} color={Colors.white} />
          ) : (
            <CircleAlert size={26} color={Colors.white} />
          )}
        </View>
        {state === 'loading' ? <ActivityIndicator color={Colors.primary} /> : null}
        <Text style={styles.title}>
          {state === 'loading' ? 'One moment' : state === 'success' ? 'You’re verified' : 'Link not valid'}
        </Text>
        <Text style={styles.message}>{message}</Text>
        {state !== 'loading' ? (
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.replace(state === 'success' && status === 'authenticated' ? '/' : '/auth/login')}
            activeOpacity={0.85}
          >
            <Text style={styles.buttonText}>
              {state === 'success' && status === 'authenticated' ? 'Continue' : 'Go to sign in'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28 },
  icon: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: 18 },
  message: { color: Colors.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 10 },
  button: {
    minHeight: 50,
    alignSelf: 'stretch',
    marginTop: 26,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: Colors.white, fontSize: 15, fontWeight: '800' },
});
