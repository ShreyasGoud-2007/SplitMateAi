import { Colors } from '@/constants/Colors';
import { useAuth } from '@/store/authStore';
import { StatusBar } from 'expo-status-bar';
import {
    Bell,
    ChevronRight,
    HelpCircle,
    LogOut,
    Settings,
    Shield,
    Sparkles,
    User,
} from 'lucide-react-native';
import React, { useRef } from 'react';
import {
    ActivityIndicator,
    Alert,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface MenuRowProps {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  onPress?: () => void;
  danger?: boolean;
}

function MenuRow({ icon, label, sublabel, onPress, danger }: MenuRowProps) {
  return (
    <TouchableOpacity style={styles.menuRow} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.menuIcon, danger && styles.menuIconDanger]}>{icon}</View>
      <View style={styles.menuText}>
        <Text style={[styles.menuLabel, danger && styles.menuLabelDanger]}>{label}</Text>
        {sublabel ? <Text style={styles.menuSublabel}>{sublabel}</Text> : null}
      </View>
      <ChevronRight size={18} color={Colors.textMuted} strokeWidth={2} />
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = React.useState(false);
  const signingOutRef = useRef(false);
  const displayName =
    typeof user?.user_metadata?.name === 'string' && user.user_metadata.name.trim()
      ? user.user_metadata.name
      : 'SplitMate member';

  function confirmSignOut() {
    Alert.alert('Sign out?', 'You can sign in again to access your saved bill splits.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          if (signingOutRef.current) return;
          signingOutRef.current = true;
          setSigningOut(true);
          try {
            await signOut();
          } catch (error) {
            signingOutRef.current = false;
            setSigningOut(false);
            Alert.alert(
              'Could not sign out',
              error instanceof Error ? error.message : 'Please try again.',
            );
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={styles.heading}>Profile</Text>
          <TouchableOpacity style={styles.settingsBtn} activeOpacity={0.7}>
            <Settings size={20} color={Colors.textPrimary} strokeWidth={1.8} />
          </TouchableOpacity>
        </View>

        {/* Avatar card */}
        <View style={styles.avatarCard}>
          <View style={styles.avatarRing}>
            <View style={styles.avatar}>
              <User size={36} color={Colors.white} strokeWidth={1.8} />
            </View>
          </View>
          <Text style={styles.userName}>{displayName}</Text>
          <Text style={styles.userEmail}>{user?.email || 'Signed in'}</Text>
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          {[
            { label: 'Bills Split', value: '0' },
            { label: 'Total Saved', value: '₹0' },
            { label: 'Friends', value: '0' },
          ].map((stat, index, arr) => (
            <View
              key={stat.label}
              style={[
                styles.statItem,
                index === arr.length - 1 && styles.statItemLast,
              ]}
            >
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* Menu groups */}
        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.menuCard}>
          <MenuRow
            icon={<Bell size={18} color={Colors.primary} strokeWidth={2} />}
            label="Notifications"
            sublabel="Manage your alerts"
          />
          <View style={styles.menuDivider} />
          <MenuRow
            icon={<Shield size={18} color={Colors.primary} strokeWidth={2} />}
            label="Privacy & Security"
            sublabel="Data and permissions"
          />
        </View>

        <Text style={styles.sectionLabel}>App</Text>
        <View style={styles.menuCard}>
          <MenuRow
            icon={<Sparkles size={18} color={Colors.primary} strokeWidth={2} />}
            label="SplitMate AI Pro"
            sublabel="Upgrade for unlimited scans"
          />
          <View style={styles.menuDivider} />
          <MenuRow
            icon={<HelpCircle size={18} color={Colors.primary} strokeWidth={2} />}
            label="Help & Support"
          />
        </View>

        <View style={styles.menuCard}>
          <MenuRow
            icon={<LogOut size={18} color="#EF4444" strokeWidth={2} />}
            label={signingOut ? 'Signing out…' : 'Sign out'}
            sublabel="End your current session"
            danger
            onPress={confirmSignOut}
          />
          {signingOut ? <ActivityIndicator style={styles.signOutSpinner} color={Colors.primary} /> : null}
        </View>

        <Text style={styles.versionText}>SplitMate AI v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  heading: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  settingsBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Avatar card */
  avatarCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 20,
    alignItems: 'center',
    padding: 28,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: Colors.border,
    ...Platform.select({
      android: { elevation: 2 },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07,
        shadowRadius: 6,
      },
    }),
  },
  avatarRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 3,
    borderColor: Colors.primary,
    padding: 3,
    marginBottom: 14,
  },
  avatar: {
    flex: 1,
    borderRadius: 40,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userName: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 18,
  },
  editBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 28,
  },
  editBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.white,
  },

  /* Stats */
  statsRow: {
    flexDirection: 'row',
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.border,
    marginBottom: 24,
    overflow: 'hidden',
    ...Platform.select({
      android: { elevation: 1 },
    }),
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 16,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
  },
  statItemLast: {
    borderRightWidth: 0,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.primary,
  },
  statLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
    fontWeight: '500',
  },

  /* Menu */
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  menuCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.border,
    marginBottom: 16,
    overflow: 'hidden',
    ...Platform.select({
      android: { elevation: 1 },
    }),
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 14,
  },
  menuIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconDanger: {
    backgroundColor: '#FEE2E2',
  },
  menuText: {
    flex: 1,
    gap: 2,
  },
  menuLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  menuLabelDanger: {
    color: '#EF4444',
  },
  menuSublabel: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  menuDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: 16,
  },
  versionText: {
    textAlign: 'center',
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 8,
  },
  signOutSpinner: { paddingVertical: 12 },
});
