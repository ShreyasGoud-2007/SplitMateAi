import ManualEntryCard from '@/components/ManualEntryCard';
import RecentActivity from '@/components/RecentActivity';
import ScanBillCard from '@/components/ScanBillCard';
import { Colors } from '@/constants/Colors';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Bell, Sparkles, User } from 'lucide-react-native';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

function Logo() {
  return (
    <View style={styles.logoRow}>
      <View style={styles.logoIcon}>
        <Sparkles size={20} color={Colors.white} strokeWidth={2} />
      </View>
      <Text style={styles.logoText}>
        SplitMate <Text style={styles.logoAI}>AI</Text>
      </Text>
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();

  const handleScanBill = () => {
    router.push('/scan');
  };

  const handleManualEntry = () => {
    // Manual entry screen — to be wired up when backend is added
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />

      {/* ── Top Bar ── */}
      <View style={styles.topBar}>
        <Logo />
        <View style={styles.topActions}>
          <TouchableOpacity style={styles.iconBtn} activeOpacity={0.7}>
            <Bell size={22} color={Colors.textPrimary} strokeWidth={1.8} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.avatarBtn}
            activeOpacity={0.7}
            onPress={() => router.push('/(tabs)/profile')}
          >
            <User size={20} color={Colors.white} strokeWidth={2} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Scrollable Content ── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Welcome */}
        <View style={styles.welcomeBlock}>
          <Text style={styles.welcomeGreeting}>Hey, welcome! 👋</Text>
          <Text style={styles.welcomeSubtitle}>
            Had a meal with friends?{'\n'}Let's split the bill.
          </Text>
        </View>

        {/* Quick-action chips */}
        <View style={styles.chipRow}>
          <View style={styles.chip}>
            <Sparkles size={13} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.chipText}>AI-powered</Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipText}>⚡ Instant split</Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipText}>👥 Multi-person</Text>
          </View>
        </View>

        {/* Cards */}
        <ScanBillCard onPress={handleScanBill} />
        <ManualEntryCard onPress={handleManualEntry} />

        {/* Recent Activity */}
        <RecentActivity items={[]} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  /* Top bar */
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: Colors.background,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.4,
  },
  logoAI: {
    color: Colors.primary,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Scroll */
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 32,
  },

  /* Welcome */
  welcomeBlock: {
    marginBottom: 20,
    gap: 6,
  },
  welcomeGreeting: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  welcomeSubtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    lineHeight: 22,
  },

  /* Chips */
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primaryLight,
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
});
