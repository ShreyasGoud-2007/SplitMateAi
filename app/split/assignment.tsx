import { Colors } from '@/constants/Colors';
import { useBillStore } from '@/store/billStore';
import type { ItemAssignment, AssignmentMethod } from '@/types/itemAssignment';
import { getItemAllocationAmounts, getItemAssignmentStatus, getItemTotalPaise, updateQuantityAllocation } from '@/utils/itemAssignments';
import { formatSplitCurrency } from '@/utils/splitCurrency';
import { computeGSTPaise } from '@/types/bill';
import type { BillCurrency } from '@/types/splitSession';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeft, Check, Minus, Plus, RotateCcw, UsersRound } from 'lucide-react-native';
import { useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const METHODS: { value: AssignmentMethod; label: string }[] = [
  { value: 'quantity', label: 'By quantity' },
  { value: 'shared', label: 'Shared' },
  { value: 'single', label: 'One person' },
];

function initials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');
}

function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export default function ItemAssignmentScreen() {
  const router = useRouter();
  const {
    getBill,
    getSplitSession,
    getItemAssignments,
    setItemAssignments,
  } = useBillStore();
  const bill = getBill();
  const session = getSplitSession();
  const [assignments, setAssignments] = useState(getItemAssignments);

  const participants = session?.participants ?? [];
  const participantIds = participants.map(({ id }) => id);
  const itemSubtotalPaise = bill?.items.reduce((sum, item) => sum + getItemTotalPaise(item), 0) ?? 0;
  const gstPaise = bill
    ? bill.detectedGstPaise ?? computeGSTPaise(itemSubtotalPaise)
    : 0;
  const serviceChargePaise = bill?.detectedServiceChargePaise ?? 0;
  const discountPaise = bill?.detectedDiscountPaise ?? 0;
  const billTotalPaise = bill
    ? Math.max(
        0,
        bill.detectedGrandTotalPaise
          ?? itemSubtotalPaise + gstPaise + serviceChargePaise - discountPaise,
      )
    : 0;
  const assignmentLimitPaise = Math.min(itemSubtotalPaise, billTotalPaise);
  const assignedPaise = bill?.items.reduce(
    (sum, item) => {
      const amounts = getItemAllocationAmounts(item, assignments[item.id], participantIds);
      return sum + Object.values(amounts).reduce((itemSum, amount) => itemSum + amount, 0);
    },
    0,
  ) ?? 0;
  const unassignedPaise = Math.max(0, itemSubtotalPaise - assignedPaise);
  const progress = itemSubtotalPaise > 0 ? Math.min(1, assignedPaise / itemSubtotalPaise) : 0;

  function saveAssignment(itemId: string, assignment: ItemAssignment | null) {
    const next = { ...assignments };
    if (assignment) next[itemId] = assignment;
    else delete next[itemId];

    const nextAssigned = bill?.items.reduce((sum, item) => {
      const amounts = getItemAllocationAmounts(item, next[item.id], participantIds);
      return sum + Object.values(amounts).reduce((itemSum, amount) => itemSum + amount, 0);
    }, 0) ?? 0;

    if (nextAssigned > assignmentLimitPaise) {
      Alert.alert(
        'Bill total reached',
        'These assignments would exceed the bill total. Check the bill amounts before assigning more.',
      );
      return;
    }

    setAssignments(next);
    setItemAssignments(next);
  }

  function setMethod(itemId: string, method: AssignmentMethod) {
    if (assignments[itemId]?.method === method) return;
    if (method === 'quantity') {
      saveAssignment(itemId, { method, quantities: {} });
    } else if (method === 'shared') {
      saveAssignment(itemId, { method, participantIds: [] });
    } else {
      saveAssignment(itemId, { method, participantId: null });
    }
  }

  function toggleSharedParticipant(itemId: string, participantId: string) {
    const current = assignments[itemId];
    const selected = current?.method === 'shared' ? current.participantIds : [];
    const participantIds = selected.includes(participantId)
      ? selected.filter((id) => id !== participantId)
      : [...selected, participantId];
    saveAssignment(itemId, { method: 'shared', participantIds });
  }

  function selectSingleParticipant(itemId: string, participantId: string) {
    const current = assignments[itemId];
    const selected = current?.method === 'single' ? current.participantId : null;
    saveAssignment(itemId, {
      method: 'single',
      participantId: selected === participantId ? null : participantId,
    });
  }

  function changeQuantity(itemId: string, participantId: string, delta: number, purchasedQuantity: number) {
    const nextAssignment = updateQuantityAllocation(
      assignments[itemId],
      participantId,
      delta,
      purchasedQuantity,
    );
    saveAssignment(itemId, nextAssignment);
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <View style={styles.emptyState}>
          <UsersRound size={35} color={Colors.primary} strokeWidth={1.7} />
          <Text style={styles.emptyTitle}>Set up your group first</Text>
          <Text style={styles.emptySubtitle}>Add the people sharing this bill before assigning items.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => router.replace('/split/new')}>
            <Text style={styles.primaryButtonText}>Set up group</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!bill) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <View style={styles.emptyState}>
          <UsersRound size={35} color={Colors.primary} strokeWidth={1.7} />
          <Text style={styles.emptyTitle}>No bill items to assign</Text>
          <Text style={styles.emptySubtitle}>
            Add or scan a bill first. Your group, “{session.groupName}”, will stay saved.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => router.push('/scan')}>
            <Text style={styles.primaryButtonText}>Add a bill</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (bill.items.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>This bill has no items</Text>
          <Text style={styles.emptySubtitle}>Go back to the bill and add items before assigning.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => router.back()}>
            <Text style={styles.primaryButtonText}>Back to bill</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.75}
        >
          <ArrowLeft size={21} color={Colors.textPrimary} strokeWidth={2} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Assign items</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {session.groupName} · {participants.length} people
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {bill.isDemoData && (
          <View style={styles.demoNotice}>
            <Text style={styles.demoNoticeText}>
              Sample bill · Assignments below use editable demo items, not your photo.
            </Text>
          </View>
        )}

        <View style={styles.summaryCard}>
          <View style={styles.summaryTop}>
            <View>
              <Text style={styles.summaryLabel}>Bill total</Text>
              <Text style={styles.billTotal}>
                {formatSplitCurrency(billTotalPaise, session.currency)}
              </Text>
            </View>
            <View style={styles.progressBadge}>
              <Text style={styles.progressText}>{Math.round(progress * 100)}% assigned</Text>
            </View>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
          <View style={styles.summaryRows}>
            <SummaryRow
              label="Items subtotal"
              amount={itemSubtotalPaise}
              currency={session.currency}
            />
            <SummaryRow
              label={bill.detectedGstPaise === null || bill.detectedGstPaise === undefined ? 'Estimated GST (5%) · not assigned' : 'GST · not assigned'}
              amount={gstPaise}
              currency={session.currency}
            />
            {serviceChargePaise > 0 && (
              <SummaryRow label="Service charge · not assigned" amount={serviceChargePaise} currency={session.currency} />
            )}
            {discountPaise > 0 && (
              <SummaryRow label="Discount" amount={-discountPaise} currency={session.currency} />
            )}
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.assignedSummary}>
            <SummaryRow label="Assigned items" amount={assignedPaise} currency={session.currency} strong />
            <SummaryRow label="Unassigned items" amount={unassignedPaise} currency={session.currency} />
          </View>
        </View>

        <View style={styles.listHeading}>
          <Text style={styles.listTitle}>Bill items</Text>
          <Text style={styles.listHint}>Assign every item or leave it unassigned for now.</Text>
        </View>

        {bill.items.map((item, index) => {
          const assignment = assignments[item.id];
          const totalPaise = getItemTotalPaise(item);
          const amountMap = getItemAllocationAmounts(item, assignment, participantIds);
          const itemAssigned = Object.values(amountMap).reduce((sum, amount) => sum + amount, 0);
          const status = getItemAssignmentStatus(item, assignment, participantIds);
          const allocatedQuantity = assignment?.method === 'quantity'
            ? Object.values(assignment.quantities).reduce((sum, quantity) => sum + Math.max(0, quantity), 0)
            : 0;
          const remainingQuantity = Math.max(0, item.qty - allocatedQuantity);

          return (
            <View key={item.id} style={styles.itemCard}>
              <View style={styles.itemHeader}>
                <View style={styles.itemNumber}>
                  <Text style={styles.itemNumberText}>{index + 1}</Text>
                </View>
                <View style={styles.itemDetails}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemMeta}>
                    {formatQuantity(item.qty)} × {formatSplitCurrency(item.unitPricePaise, session.currency)}
                  </Text>
                </View>
                <View style={styles.itemTotalWrap}>
                  <Text style={styles.itemTotal}>
                    {formatSplitCurrency(totalPaise, session.currency)}
                  </Text>
                  <Text style={[
                    styles.status,
                    status === 'assigned' && styles.statusAssigned,
                    status === 'partial' && styles.statusPartial,
                  ]}>
                    {status === 'assigned' ? 'Assigned' : status === 'partial' ? 'Partial' : 'Unassigned'}
                  </Text>
                </View>
              </View>

              <View style={styles.methodRow}>
                {METHODS.map((method) => {
                  const selected = (assignment?.method ?? 'quantity') === method.value;
                  return (
                    <TouchableOpacity
                      key={method.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={[styles.methodButton, selected && styles.methodButtonSelected]}
                      onPress={() => setMethod(item.id, method.value)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.methodText, selected && styles.methodTextSelected]}>
                        {method.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {assignment?.method === 'shared' ? (
                <View style={styles.assignmentArea}>
                  <Text style={styles.assignmentHint}>Choose everyone sharing the whole item:</Text>
                  <View style={styles.chipRow}>
                    {participants.map((participant) => {
                      const selected = assignment.participantIds.includes(participant.id);
                      return (
                        <ParticipantChip
                          key={participant.id}
                          name={participant.name}
                          selected={selected}
                          onPress={() => toggleSharedParticipant(item.id, participant.id)}
                        />
                      );
                    })}
                  </View>
                  {assignment.participantIds.length > 0 && (
                    <Text style={styles.allocationHint}>
                      {assignment.participantIds.length} sharing · approximately{' '}
                      {formatSplitCurrency(Math.floor(totalPaise / assignment.participantIds.length), session.currency)} each
                    </Text>
                  )}
                </View>
              ) : assignment?.method === 'single' ? (
                <View style={styles.assignmentArea}>
                  <Text style={styles.assignmentHint}>Choose one person for the full item:</Text>
                  <View style={styles.chipRow}>
                    {participants.map((participant) => (
                      <ParticipantChip
                        key={participant.id}
                        name={participant.name}
                        selected={assignment.participantId === participant.id}
                        onPress={() => selectSingleParticipant(item.id, participant.id)}
                      />
                    ))}
                  </View>
                </View>
              ) : (
                <View style={styles.assignmentArea}>
                  <View style={styles.quantityHeading}>
                    <Text style={styles.assignmentHint}>Allocate up to {formatQuantity(item.qty)} units:</Text>
                    <Text style={styles.remainingText}>
                      {formatQuantity(remainingQuantity)} left
                    </Text>
                  </View>
                  {participants.map((participant) => {
                    const quantity = assignment?.method === 'quantity'
                      ? assignment.quantities[participant.id] ?? 0
                      : 0;
                    return (
                      <View key={participant.id} style={styles.quantityRow}>
                        <View style={styles.quantityAvatar}>
                          <Text style={styles.quantityInitials}>{initials(participant.name)}</Text>
                        </View>
                        <Text style={styles.quantityName} numberOfLines={1}>{participant.name}</Text>
                        <TouchableOpacity
                          accessibilityRole="button"
                          accessibilityLabel={`Remove one ${item.name} from ${participant.name}`}
                          style={[styles.stepButton, quantity <= 0 && styles.stepDisabled]}
                          disabled={quantity <= 0}
                          onPress={() => changeQuantity(item.id, participant.id, -1, item.qty)}
                        >
                          <Minus size={15} color={quantity <= 0 ? Colors.textMuted : Colors.primary} strokeWidth={2.5} />
                        </TouchableOpacity>
                        <Text style={styles.quantityValue}>{formatQuantity(quantity)}</Text>
                        <TouchableOpacity
                          accessibilityRole="button"
                          accessibilityLabel={`Add one ${item.name} to ${participant.name}`}
                          style={[styles.stepButton, remainingQuantity <= 0 && styles.stepDisabled]}
                          disabled={remainingQuantity <= 0}
                          onPress={() => changeQuantity(item.id, participant.id, 1, item.qty)}
                        >
                          <Plus size={15} color={remainingQuantity <= 0 ? Colors.textMuted : Colors.primary} strokeWidth={2.5} />
                        </TouchableOpacity>
                        <Text style={styles.quantityCost}>
                          {formatSplitCurrency(amountMap[participant.id] ?? 0, session.currency)}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}

              <View style={styles.itemFooter}>
                <Text style={styles.itemFooterText}>
                  {formatSplitCurrency(Math.max(0, totalPaise - itemAssigned), session.currency)} unassigned
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Reset assignment for ${item.name}`}
                  style={styles.resetButton}
                  onPress={() => saveAssignment(item.id, null)}
                  activeOpacity={0.7}
                >
                  <RotateCcw size={13} color={Colors.textSecondary} strokeWidth={2} />
                  <Text style={styles.resetText}>Reset</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.bottomBar}>
        <View style={styles.bottomTotal}>
          <Text style={styles.bottomLabel}>Assigned</Text>
          <Text style={styles.bottomValue}>
            {formatSplitCurrency(assignedPaise, session.currency)}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.continueButton}
          onPress={() => router.push('/split/summary')}
          activeOpacity={0.85}
        >
          <Check size={18} color={Colors.white} strokeWidth={2.5} />
          <Text style={styles.continueText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function SummaryRow({
  label,
  amount,
  currency,
  strong = false,
}: {
  label: string;
  amount: number;
  currency: BillCurrency;
  strong?: boolean;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryRowLabel, strong && styles.summaryRowStrong]}>{label}</Text>
      <Text style={[styles.summaryRowValue, strong && styles.summaryRowStrong]}>
        {formatSplitCurrency(amount, currency)}
      </Text>
    </View>
  );
}

function ParticipantChip({
  name,
  selected,
  onPress,
}: {
  name: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      activeOpacity={0.75}
      style={[styles.participantChip, selected && styles.participantChipSelected]}
    >
      {selected && <Check size={13} color={Colors.white} strokeWidth={2.5} />}
      <Text style={[styles.participantChipText, selected && styles.participantChipTextSelected]}>
        {name}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 13,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headerCopy: { flex: 1, gap: 3 },
  headerTitle: { color: Colors.textPrimary, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  headerSubtitle: { color: Colors.textSecondary, fontSize: 12 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 22 },
  demoNotice: { padding: 11, borderRadius: 12, marginBottom: 12, backgroundColor: '#fff7ed' },
  demoNoticeText: { color: '#9a3412', fontSize: 12, lineHeight: 17, fontWeight: '600' },
  summaryCard: {
    padding: 15,
    borderRadius: 18,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  summaryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  billTotal: { color: Colors.textPrimary, fontSize: 23, fontWeight: '800', marginTop: 3 },
  progressBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: Colors.primaryLight },
  progressText: { color: Colors.primary, fontSize: 11, fontWeight: '800' },
  progressTrack: { height: 7, borderRadius: 5, overflow: 'hidden', backgroundColor: Colors.background, marginTop: 14 },
  progressFill: { height: '100%', borderRadius: 5, backgroundColor: Colors.primary },
  summaryRows: { gap: 7, marginTop: 13 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  summaryRowLabel: { flex: 1, color: Colors.textSecondary, fontSize: 12 },
  summaryRowValue: { color: Colors.textPrimary, fontSize: 12, fontWeight: '600' },
  summaryRowStrong: { color: Colors.textPrimary, fontWeight: '800' },
  summaryDivider: { height: 1, backgroundColor: Colors.border, marginVertical: 12 },
  assignedSummary: { gap: 8 },
  listHeading: { marginTop: 20, marginBottom: 10 },
  listTitle: { color: Colors.textPrimary, fontSize: 17, fontWeight: '800' },
  listHint: { color: Colors.textSecondary, fontSize: 12, marginTop: 3 },
  itemCard: {
    padding: 13,
    marginBottom: 11,
    borderRadius: 17,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemNumber: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primaryLight },
  itemNumberText: { color: Colors.primary, fontSize: 12, fontWeight: '800' },
  itemDetails: { flex: 1, gap: 3 },
  itemName: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  itemMeta: { color: Colors.textSecondary, fontSize: 11 },
  itemTotalWrap: { alignItems: 'flex-end', gap: 3 },
  itemTotal: { color: Colors.textPrimary, fontSize: 13, fontWeight: '800' },
  status: { color: Colors.textMuted, fontSize: 10, fontWeight: '700' },
  statusAssigned: { color: Colors.primary },
  statusPartial: { color: '#b45309' },
  methodRow: { flexDirection: 'row', gap: 6, marginTop: 14, padding: 4, borderRadius: 12, backgroundColor: Colors.background },
  methodButton: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: 9 },
  methodButtonSelected: { backgroundColor: Colors.primary },
  methodText: { color: Colors.textSecondary, fontSize: 10, fontWeight: '700', textAlign: 'center' },
  methodTextSelected: { color: Colors.white },
  assignmentArea: { marginTop: 12 },
  assignmentHint: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 9 },
  participantChip: {
    minHeight: 35,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  participantChipSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  participantChipText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700' },
  participantChipTextSelected: { color: Colors.white },
  allocationHint: { color: Colors.primary, fontSize: 11, fontWeight: '700', marginTop: 8 },
  quantityHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  remainingText: { color: Colors.primary, fontSize: 11, fontWeight: '700' },
  quantityRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 7 },
  quantityAvatar: { width: 27, height: 27, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primaryLight },
  quantityInitials: { color: Colors.primary, fontSize: 9, fontWeight: '800' },
  quantityName: { flex: 1, color: Colors.textPrimary, fontSize: 11, fontWeight: '600' },
  stepButton: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primaryLight },
  stepDisabled: { backgroundColor: Colors.background },
  quantityValue: { minWidth: 20, textAlign: 'center', color: Colors.textPrimary, fontSize: 12, fontWeight: '800' },
  quantityCost: { minWidth: 58, textAlign: 'right', color: Colors.textSecondary, fontSize: 10, fontWeight: '600' },
  itemFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 9, paddingTop: 9, borderTopWidth: 1, borderTopColor: Colors.border },
  itemFooterText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600' },
  resetButton: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingLeft: 8 },
  resetText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600' },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 17,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'android' ? 12 : 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.white,
  },
  bottomTotal: { flex: 1, gap: 3 },
  bottomLabel: { color: Colors.textSecondary, fontSize: 11 },
  bottomValue: { color: Colors.textPrimary, fontSize: 16, fontWeight: '800' },
  continueButton: { height: 47, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 19, borderRadius: 14, backgroundColor: Colors.primary },
  continueText: { color: Colors.white, fontSize: 14, fontWeight: '800' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 25, gap: 11 },
  emptyTitle: { color: Colors.textPrimary, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  emptySubtitle: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  primaryButton: { paddingHorizontal: 20, paddingVertical: 13, marginTop: 5, borderRadius: 13, backgroundColor: Colors.primary },
  primaryButtonText: { color: Colors.white, fontWeight: '700' },
});
