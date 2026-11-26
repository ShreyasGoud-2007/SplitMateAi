import { Colors } from '@/constants/Colors';
import { useAuth } from '@/store/authStore';
import { getSupabaseClient } from '@/utils/supabase';
import * as Linking from 'expo-linking';
import { Link } from 'expo-router';
import { Eye, EyeOff, LockKeyhole, Mail, Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface AuthFormProps {
  mode: 'login' | 'signup';
}

function friendlyAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login credentials')) {
    return 'That email and password combination was not recognized.';
  }
  if (normalized.includes('email not confirmed')) {
    return 'Please confirm your email from the message we sent before signing in.';
  }
  if (normalized.includes('user already registered')) {
    return 'An account already exists for this email. Try signing in instead.';
  }
  if (normalized.includes('password should be')) {
    return 'Choose a stronger password and try again.';
  }
  if (normalized.includes('rate limit')) {
    return 'Too many attempts. Please wait a little and try again.';
  }
  return message || 'We could not complete that request. Please try again.';
}

export default function AuthForm({ mode }: AuthFormProps) {
  const { initializationError } = useAuth();
  const isSignup = mode === 'signup';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setErrorMessage(null);
    setSuccessMessage(null);

    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setErrorMessage('Enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setErrorMessage('Your password must be at least 6 characters.');
      return;
    }
    if (isSignup && password !== confirmPassword) {
      setErrorMessage('The passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const client = getSupabaseClient();
      if (isSignup) {
        const emailRedirectTo = Linking.createURL('auth/callback');
        const { data, error } = await client.auth.signUp({
          email: normalizedEmail,
          password,
          options: { emailRedirectTo },
        });
        if (error) throw error;

        if (data.session) {
          setSuccessMessage('Your account is ready. Opening SplitMate AI…');
        } else {
          setSuccessMessage(
            `Check ${normalizedEmail} for a confirmation link. Open it on this device to verify your account, then sign in.`,
          );
        }
      } else {
        const { error } = await client.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (error) throw error;
      }
    } catch (error) {
      setErrorMessage(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandIcon}>
            <Sparkles size={25} color={Colors.white} strokeWidth={2} />
          </View>
          <Text style={styles.brand}>SplitMate <Text style={styles.brandAccent}>AI</Text></Text>
          <Text style={styles.title}>{isSignup ? 'Create your account' : 'Welcome back'}</Text>
          <Text style={styles.subtitle}>
            {isSignup
              ? 'Sign up to save and revisit your group bill splits.'
              : 'Sign in to continue to your saved bill splits.'}
          </Text>

          {initializationError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{initializationError}</Text>
            </View>
          ) : null}
          {errorMessage ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}
          {successMessage ? (
            <View style={styles.successBox}>
              <Text style={styles.successText}>{successMessage}</Text>
            </View>
          ) : null}

          <Text style={styles.label}>Email</Text>
          <View style={styles.inputWrap}>
            <Mail size={18} color={Colors.textMuted} strokeWidth={2} />
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              editable={!busy}
              accessibilityLabel="Email address"
            />
          </View>

          <Text style={styles.label}>Password</Text>
          <View style={styles.inputWrap}>
            <LockKeyhole size={18} color={Colors.textMuted} strokeWidth={2} />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="At least 6 characters"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
              secureTextEntry={!passwordVisible}
              autoCapitalize="none"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              textContentType={isSignup ? 'newPassword' : 'password'}
              returnKeyType={isSignup ? 'next' : 'done'}
              onSubmitEditing={isSignup ? undefined : submit}
              editable={!busy}
              accessibilityLabel="Password"
            />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
              onPress={() => setPasswordVisible((visible) => !visible)}
              hitSlop={8}
            >
              {passwordVisible
                ? <EyeOff size={19} color={Colors.textMuted} />
                : <Eye size={19} color={Colors.textMuted} />}
            </TouchableOpacity>
          </View>

          {isSignup ? (
            <>
              <Text style={styles.label}>Confirm password</Text>
              <View style={styles.inputWrap}>
                <LockKeyhole size={18} color={Colors.textMuted} strokeWidth={2} />
                <TextInput
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Re-enter your password"
                  placeholderTextColor={Colors.textMuted}
                  style={styles.input}
                  secureTextEntry={!confirmVisible}
                  autoCapitalize="none"
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="done"
                  onSubmitEditing={submit}
                  editable={!busy}
                  accessibilityLabel="Confirm password"
                />
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={confirmVisible ? 'Hide confirmation password' : 'Show confirmation password'}
                  onPress={() => setConfirmVisible((visible) => !visible)}
                  hitSlop={8}
                >
                  {confirmVisible
                    ? <EyeOff size={19} color={Colors.textMuted} />
                    : <Eye size={19} color={Colors.textMuted} />}
                </TouchableOpacity>
              </View>
            </>
          ) : null}

          <TouchableOpacity
            style={[styles.submitButton, busy && styles.submitDisabled]}
            onPress={submit}
            disabled={busy}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.submitText}>{isSignup ? 'Create account' : 'Sign in'}</Text>
            )}
          </TouchableOpacity>

          <View style={styles.switchRow}>
            <Text style={styles.switchText}>
              {isSignup ? 'Already have an account? ' : "Don't have an account? "}
            </Text>
            <Link href={isSignup ? '/auth/login' : '/auth/signup'} style={styles.switchLink}>
              {isSignup ? 'Sign in' : 'Sign up'}
            </Link>
          </View>
          {isSignup && successMessage ? (
            <View style={styles.backToLogin}>
              <Link href="/auth/login" style={styles.switchLink}>Go to sign in</Link>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 36,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  brandIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  brand: { color: Colors.textPrimary, fontSize: 20, fontWeight: '800', marginBottom: 32 },
  brandAccent: { color: Colors.primary },
  title: { color: Colors.textPrimary, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: Colors.textSecondary, fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: 26 },
  label: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700', marginBottom: 8, marginTop: 14 },
  inputWrap: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  input: { flex: 1, minHeight: 50, color: Colors.textPrimary, fontSize: 15 },
  submitButton: {
    minHeight: 52,
    marginTop: 26,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitDisabled: { opacity: 0.7 },
  submitText: { color: Colors.white, fontSize: 16, fontWeight: '800' },
  switchRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 22, flexWrap: 'wrap' },
  switchText: { color: Colors.textSecondary, fontSize: 14 },
  switchLink: { color: Colors.primary, fontSize: 14, fontWeight: '800' },
  backToLogin: { alignItems: 'center', padding: 14 },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  errorText: { color: '#B91C1C', fontSize: 13, lineHeight: 19 },
  successBox: {
    backgroundColor: Colors.primaryLight,
    borderColor: '#A7F3D0',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  successText: { color: Colors.primaryDark, fontSize: 13, lineHeight: 19 },
});
