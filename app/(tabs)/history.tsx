import { Colors } from '@/constants/Colors';
import { useBillStore } from '@/store/billStore';
import {
  getSavedSplitSession,
  listSavedSplitSessions,
  type SavedSplitSessionSummary,
} from '@/services/supabaseStorage';
import { formatSplitCurrency } from '@/utils/splitCurrency';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { History, Receipt, RefreshCw, Search, Users } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type FilterTab = 'All' | 'Scan' | 'Manual';
const FILTER_TABS: FilterTab[] = ['All', 'Scan', 'Manual'];

function sourceLabel(source: SavedSplitSessionSummary['source']): string {
  if (source === 'ocr') return 'Scan';
  if (source === 'demo') return 'Demo';
  return 'Manual';
}

export default function HistoryScreen() {
  const router = useRouter();
  const { setBill, setSplitSession, setItemAssignments } = useBillStore();
  const [activeFilter, setActiveFilter] = useState<FilterTab>('All');
  const [search, setSearch] = useState('');
  const [sessions, setSessions] = useState<SavedSplitSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const savedSessions = await listSavedSplitSessions();
      setSessions(savedSessions);
    } catch (error) {
      setSessions([]);
      setErrorMessage(
        error instanceof Error ? error.message : 'Could not load saved split history.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setErrorMessage(null);
      listSavedSplitSessions()
        .then((savedSessions) => {
          if (active) setSessions(savedSessions);
        })
        .catch((error: unknown) => {
          if (!active) return;
          setSessions([]);
          setErrorMessage(
            error instanceof Error ? error.message : 'Could not load saved split history.',
          );
        })
        .finally(() => {
          if (active) setLoading(false);
        });

      return () => {
        active = false;
      };
    }, []),
  );

  const visibleSessions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return sessions.filter((session) => {
      const matchesFilter =
        activeFilter === 'All' ||
        (activeFilter === 'Scan' && session.source === 'ocr') ||
        (activeFilter === 'Manual' && session.source === 'manual');
      const matchesSearch =
        !query ||
        session.groupName.toLocaleLowerCase().includes(query) ||
        (session.restaurantName ?? '').toLocaleLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [activeFilter, search, sessions]);

  async function openSavedSession(sessionId: string) {
    if (openingId) return;
    setOpeningId(sessionId);
    try {
      const loaded = await getSavedSplitSession(sessionId);
      // Only replace the in-memory session after the complete saved snapshot loaded.
      setBill(loaded.bill);
      setSplitSession(loaded.session);
      setItemAssignments(loaded.assignments);
      router.push('/split/summary');
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Could not open this saved split.',
      );
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <View>
          <Text style={styles.heading}>History</Text>
          <Text style={styles.subheading}>Your saved bill splits</Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Refresh saved history"
          style={styles.refreshButton}
          onPress={loadHistory}
          disabled={loading}
          activeOpacity={0.75}
        >
          <RefreshCw size={18} color={Colors.textPrimary} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      <View style={styles.searchBar}>
        <Search size={18} color={Colors.textMuted} strokeWidth={2} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search groups or restaurants"
          placeholderTextColor={Colors.textMuted}
          style={styles.searchInput}
          returnKeyType="search"
          accessibilityLabel="Search saved splits"
        />
      </View>

      <View style={styles.filterRow}>
        {FILTER_TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.filterChip, activeFilter === tab && styles.filterChipActive]}
            onPress={() => setActiveFilter(tab)}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterChipText, activeFilter === tab && styles.filterChipTextActive]}>
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          visibleSessions.length === 0 && styles.scrollEmpty,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.stateBlock}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.stateText}>Loading saved splits…</Text>
          </View>
        ) : errorMessage ? (
          <View style={styles.stateBlock}>
            <View style={styles.emptyIconOuter}>
              <History size={36} color={Colors.primary} strokeWidth={1.5} />
            </View>
            <Text style={styles.emptyTitle}>History needs sign-in</Text>
            <Text style={styles.emptySubtitle}>{errorMessage}</Text>
            <Text style={styles.authNote}>
              Cloud history uses authenticated Supabase access. It will be available after account sign-in is added and the database migration is applied.
            </Text>
            <TouchableOpacity style={styles.retryButton} onPress={loadHistory} activeOpacity={0.8}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : visibleSessions.length === 0 ? (
          <View style={styles.stateBlock}>
            <View style={styles.emptyIconOuter}>
              <History size={36} color={Colors.primary} strokeWidth={1.5} />
            </View>
            <Text style={styles.emptyTitle}>
              {sessions.length === 0 ? 'No saved splits yet' : 'No matches found'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {sessions.length === 0
                ? 'Save a split summary to see it here.'
                : 'Try a different search or history filter.'}
            </Text>
            {sessions.length === 0 && (
              <View style={styles.hintCard}>
                <Receipt size={16} color={Colors.primary} strokeWidth={2} />
                <Text style={styles.hintText}>
                  Create a group split, assign bill items, then save its summary.
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.sessionList}>
            {visibleSessions.map((session) => (
              <TouchableOpacity
                key={session.id}
                style={styles.sessionCard}
                onPress={() => openSavedSession(session.id)}
                disabled={openingId !== null}
                activeOpacity={0.8}
              >
                <View style={styles.sessionIcon}>
                  <Receipt size={20} color={Colors.primary} strokeWidth={1.9} />
                </View>
                <View style={styles.sessionDetails}>
                  <Text style={styles.sessionName} numberOfLines={1}>{session.groupName}</Text>
                  <Text style={styles.sessionRestaurant} numberOfLines={1}>
                    {session.restaurantName || 'Restaurant not specified'}
                  </Text>
                  <View style={styles.sessionMeta}>
                    <Text style={styles.sourceBadge}>{sourceLabel(session.source)}</Text>
                    <Text style={styles.metaText}>
                      {new Date(session.createdAt).toLocaleDateString()}
                    </Text>
                    <View style={styles.peopleMeta}>
                      <Users size={12} color={Colors.textMuted} strokeWidth={2} />
                      <Text style={styles.metaText}>{session.participantCount}</Text>
                    </View>
                  </View>
                </View>
                <View style={styles.sessionTotalWrap}>
                  {openingId === session.id ? (
                    <ActivityIndicator size="small" color={Colors.primary} />
                  ) : (
                    <Text style={styles.sessionTotal}>
                      {formatSplitCurrency(session.totalPaise, session.currency)}
                    </Text>
                  )}
                  <Text style={styles.openHint}>View summary</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  heading: { fontSize: 26, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.5 },
  subheading: { fontSize: 14, color: Colors.textSecondary, marginTop: 2 },
  refreshButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  searchInput: { flex: 1, minHeight: 45, color: Colors.textPrimary, fontSize: 14 },
  filterRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 8, marginBottom: 8 },
  filterChip: {
    paddingVertical: 7,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  filterChipTextActive: { color: Colors.white },
  scrollContent: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 30 },
  scrollEmpty: { justifyContent: 'center' },
  stateBlock: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 7 },
  stateText: { color: Colors.textSecondary, fontSize: 14 },
  emptyIconOuter: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 19, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  emptySubtitle: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, maxWidth: 310 },
  authNote: { fontSize: 12, color: Colors.textMuted, textAlign: 'center', lineHeight: 18, maxWidth: 320 },
  retryButton: { backgroundColor: Colors.primaryLight, paddingHorizontal: 17, paddingVertical: 9, borderRadius: 12 },
  retryText: { color: Colors.primary, fontWeight: '700', fontSize: 13 },
  hintCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.primaryLight,
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
    maxWidth: 310,
  },
  hintText: { fontSize: 12, color: Colors.primary, fontWeight: '500', flex: 1, lineHeight: 18 },
  sessionList: { gap: 10 },
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 13,
    borderRadius: 16,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sessionIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primaryLight },
  sessionDetails: { flex: 1, gap: 3 },
  sessionName: { color: Colors.textPrimary, fontSize: 14, fontWeight: '800' },
  sessionRestaurant: { color: Colors.textSecondary, fontSize: 11 },
  sessionMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 3 },
  sourceBadge: { color: Colors.primary, backgroundColor: Colors.primaryLight, overflow: 'hidden', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, fontSize: 9, fontWeight: '800' },
  metaText: { color: Colors.textMuted, fontSize: 10 },
  peopleMeta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  sessionTotalWrap: { alignItems: 'flex-end', gap: 5 },
  sessionTotal: { color: Colors.textPrimary, fontSize: 12, fontWeight: '800' },
  openHint: { color: Colors.primary, fontSize: 9, fontWeight: '700' },
});
