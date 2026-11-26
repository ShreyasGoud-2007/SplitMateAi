import { Colors } from '@/constants/Colors';
import { useBillStore } from '@/store/billStore';
import { computeGSTPaise } from '@/types/bill';
import { getItemAllocationAmounts, getItemTotalPaise } from '@/utils/itemAssignments';
import { formatSplitCurrency } from '@/utils/splitCurrency';
import { saveSplitSession } from '@/services/supabaseStorage';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeft, CheckCircle2, UsersRound } from 'lucide-react-native';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function SplitSummaryScreen() {
  const router = useRouter();
  const { getBill, getSplitSession, getItemAssignments } = useBillStore();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const savingRef = useRef(false);
  const bill = getBill();
  const session = getSplitSession();
  const assignments = getItemAssignments();

  if (!session || !bill) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Summary unavailable</Text>
          <Text style={styles.emptySubtitle}>Set up a group and bill before reviewing the split.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => router.replace('/split/assignment')}>
            <Text style={styles.primaryButtonText}>Back to assignments</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const participantIds = session.participants.map(({ id }) => id);
  const participantTotals = Object.fromEntries(participantIds.map((id) => [id, 0])) as Record<string, number>;
  const itemSubtotalPaise = bill.items.reduce((sum, item) => sum + getItemTotalPaise(item), 0);

  for (const item of bill.items) {
    const amounts = getItemAllocationAmounts(item, assignments[item.id], participantIds);
    for (const [participantId, amount] of Object.entries(amounts)) {
      participantTotals[participantId] += amount;
    }
  }

  const assignedPaise = Object.values(participantTotals).reduce((sum, amount) => sum + amount, 0);
  const unassignedPaise = Math.max(0, itemSubtotalPaise - assignedPaise);
  const gstPaise = bill.detectedGstPaise ?? computeGSTPaise(itemSubtotalPaise);
  const serviceChargePaise = bill.detectedServiceChargePaise ?? 0;
  const discountPaise = bill.detectedDiscountPaise ?? 0;
  const billTotalPaise = Math.max(
    0,
    bill.detectedGrandTotalPaise
      ?? itemSubtotalPaise + gstPaise + serviceChargePaise - discountPaise,
  );
  const formatMoney = (amount: number) => formatSplitCurrency(amount, session.currency);

  async function handleSaveSplit() {
    if (!session || !bill) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await saveSplitSession(session, bill, assignments);
      setSaved(true);
      Alert.alert('Split saved', 'This split is now available in your saved history.');
    } catch (error) {
      Alert.alert(
        'Could not save split',
        error instanceof Error ? error.message : 'An unexpected error occurred while saving this split.',
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back to assignments"
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.75}
        >
          <ArrowLeft size={21} color={Colors.textPrimary} strokeWidth={2} />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>Split summary</Text>
          <Text style={styles.headerSubtitle}>{session.groupName}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.totalCard}>
          <View style={styles.totalIcon}>
            <CheckCircle2 size={22} color={Colors.primary} strokeWidth={2} />
          </View>
          <Text style={styles.totalLabel}>Bill total</Text>
          <Text style={styles.totalAmount}>{formatMoney(billTotalPaise)}</Text>
          <Text style={styles.totalCaption}>{session.restaurantName || session.groupName}</Text>
        </View>

        {bill.isDemoData && (
          <View style={styles.demoNotice}>
            <Text style={styles.demoNoticeText}>
              Sample bill summary · amounts use demo items and are not from your photo.
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Items and charges</Text>
          <SummaryRow label="Items subtotal" amount={itemSubtotalPaise} format={formatMoney} />
          <SummaryRow
            label={bill.detectedGstPaise == null ? 'Estimated GST (5%) · not split yet' : 'GST · not split yet'}
            amount={gstPaise}
            format={formatMoney}
          />
          {serviceChargePaise > 0 && (
            <SummaryRow label="Service charge · not split yet" amount={serviceChargePaise} format={formatMoney} />
          )}
          {discountPaise > 0 && (
            <SummaryRow label="Discount" amount={-discountPaise} format={formatMoney} />
          )}
          <View style={styles.divider} />
          <SummaryRow label="Assigned items" amount={assignedPaise} format={formatMoney} strong />
          <SummaryRow label="Unassigned items" amount={unassignedPaise} format={formatMoney} />
        </View>

        <View style={styles.peopleHeading}>
          <UsersRound size={18} color={Colors.primary} strokeWidth={2} />
          <Text style={styles.peopleTitle}>Participant totals</Text>
        </View>
        <View style={styles.card}>
          {session.participants.map((participant, index) => (
            <View
              key={participant.id}
              style={[styles.personRow, index < session.participants.length - 1 && styles.personDivider]}
            >
              <View style={styles.personAvatar}>
                <Text style={styles.personInitials}>
                  {participant.name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('')}
                </Text>
              </View>
              <View style={styles.personCopy}>
                <Text style={styles.personName}>{participant.name}</Text>
                <Text style={styles.personCaption}>Assigned items only · tax not included</Text>
              </View>
              <Text style={styles.personAmount}>{formatMoney(participantTotals[participant.id] ?? 0)}</Text>
            </View>
          ))}
        </View>

        {unassignedPaise > 0 && (
          <View style={styles.unassignedNotice}>
            <Text style={styles.unassignedTitle}>Some items are still unassigned</Text>
            <Text style={styles.unassignedText}>
              {formatMoney(unassignedPaise)} of the item subtotal has not been allocated. You can go back and assign it.
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.primaryButton, saving && styles.primaryButtonDisabled]}
          onPress={handleSaveSplit}
          activeOpacity={0.85}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={Colors.white} />
          ) : saved ? (
            <CheckCircle2 size={18} color={Colors.white} strokeWidth={2.5} />
          ) : null}
          <Text style={styles.primaryButtonText}>
            {saving
              ? 'Saving split…'
              : saved
                ? 'Saved · update history'
                : 'Save split to history'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => router.back()}
          activeOpacity={0.85}
        >
          <Text style={styles.secondaryButtonText}>Back to item assignment</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryRow({
  label,
  amount,
  format,
  strong = false,
}: {
  label: string;
  amount: number;
  format: (amount: number) => string;
  strong?: boolean;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.rowLabel, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.rowAmount, strong && styles.strong]}>{format(amount)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 19, paddingTop: 9, paddingBottom: 15 },
  backButton: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: Colors.border },
  headerTitle: { color: Colors.textPrimary, fontSize: 20, fontWeight: '800' },
  headerSubtitle: { color: Colors.textSecondary, fontSize: 12, marginTop: 3 },
  content: { paddingHorizontal: 17, paddingBottom: 32 },
  totalCard: { alignItems: 'center', padding: 21, borderRadius: 19, backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: Colors.border },
  totalIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primaryLight, marginBottom: 10 },
  totalLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  totalAmount: { color: Colors.textPrimary, fontSize: 28, fontWeight: '800', marginTop: 3 },
  totalCaption: { color: Colors.textSecondary, fontSize: 12, marginTop: 4 },
  demoNotice: { padding: 11, borderRadius: 12, marginTop: 12, backgroundColor: '#fff7ed' },
  demoNoticeText: { color: '#9a3412', fontSize: 12, lineHeight: 17, fontWeight: '600' },
  card: { padding: 15, marginTop: 14, borderRadius: 16, backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: Colors.border },
  cardTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '800', marginBottom: 13 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginTop: 9 },
  rowLabel: { flex: 1, color: Colors.textSecondary, fontSize: 12 },
  rowAmount: { color: Colors.textPrimary, fontSize: 12, fontWeight: '600' },
  strong: { color: Colors.textPrimary, fontWeight: '800' },
  divider: { height: 1, backgroundColor: Colors.border, marginTop: 13 },
  peopleHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 23, marginBottom: -3 },
  peopleTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800' },
  personRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  personDivider: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  personAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primaryLight },
  personInitials: { color: Colors.primary, fontSize: 12, fontWeight: '800' },
  personCopy: { flex: 1, gap: 2 },
  personName: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700' },
  personCaption: { color: Colors.textSecondary, fontSize: 10 },
  personAmount: { color: Colors.textPrimary, fontSize: 13, fontWeight: '800' },
  unassignedNotice: { padding: 13, marginTop: 13, borderRadius: 13, backgroundColor: '#fff7ed' },
  unassignedTitle: { color: '#9a3412', fontSize: 12, fontWeight: '800' },
  unassignedText: { color: '#9a3412', fontSize: 11, lineHeight: 16, marginTop: 4 },
  primaryButton: { height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 15, borderRadius: 14, backgroundColor: Colors.primary },
  primaryButtonDisabled: { opacity: 0.7 },
  primaryButtonText: { color: Colors.white, fontSize: 14, fontWeight: '800' },
  secondaryButton: { height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 10, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white },
  secondaryButtonText: { color: Colors.primary, fontSize: 14, fontWeight: '700' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 10 },
  emptyTitle: { color: Colors.textPrimary, fontSize: 19, fontWeight: '800' },
  emptySubtitle: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center' },
});
