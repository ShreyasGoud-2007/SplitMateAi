/**
 * app/scan/results.tsx
 * Extracted Bill Management screen for SplitMate AI.
 *
 * Features:
 *  - Bill image preview + item count
 *  - Editable item list (name · qty · unit price · line total)
 *  - Add / Edit / Delete items via bottom-sheet modal
 *  - Paise-based arithmetic (no floating-point rounding errors)
 *  - Tip selector (0 / 5 / 10 / 15 / 20 %)
 *  - GST 5 % calculation
 *  - Bill validation card (computed vs detected subtotal + diff)
 *  - Demo-data notice (clearly not claimed as OCR output)
 */

import { Colors } from '@/constants/Colors';
import { useBillStore } from '@/store/billStore';
import {
    type BillItem,
    type BillValidationWarning,
    type TipOption,
    TIP_OPTIONS,
    computeGSTPaise,
    computeSubtotalPaise,
    computeTipPaise,
    makeBillItem,
    makeBlankItem
} from '@/types/bill';
import { applyRatePaise, formatPaise, fromPaise, toPaise } from '@/utils/currency';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
    AlertTriangle,
    ArrowLeft,
    Check,
    CheckCircle2,
    ChevronRight,
    IndianRupee,
    Info,
    Pencil,
    Plus,
    Receipt,
    RotateCcw,
    ShieldCheck,
    Sparkles,
    Trash2,
    Users,
    X,
} from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    Image,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─────────────────────────────────────────────────────────────────────────────
// ItemModal  (Add & Edit in one component)
// ─────────────────────────────────────────────────────────────────────────────

interface ItemModalProps {
  /** null → modal is closed */
  item: BillItem | null;
  onSave: (item: BillItem) => void;
  onClose: () => void;
}

function ItemModal({ item, onSave, onClose }: ItemModalProps) {
  const isNew = !item || item.unitPricePaise === 0 && item.name === '';
  const [name,  setName]  = useState('');
  const [qty,   setQty]   = useState('1');
  const [price, setPrice] = useState('');   // rupees string from user

  /* Re-populate whenever the target item changes */
  useEffect(() => {
    if (item) {
      setName(item.name);
      setQty(String(item.qty));
      // Show rupees (not paise) in the input field
      setPrice(item.unitPricePaise > 0 ? String(fromPaise(item.unitPricePaise)) : '');
    }
  }, [item?.id]);              // only re-sync when the id changes

  const parsedQty   = parseInt(qty,   10);
  const parsedPrice = parseFloat(price);
  const validQty    = !isNaN(parsedQty)   && parsedQty   >= 1;
  const validPrice  = !isNaN(parsedPrice) && parsedPrice >= 0;
  const previewPaise = validQty && validPrice
    ? toPaise(parsedPrice) * parsedQty
    : null;

  function handleSave() {
    if (!name.trim()) {
      Alert.alert('Validation', 'Item name cannot be empty.');
      return;
    }
    if (!validQty) {
      Alert.alert('Validation', 'Quantity must be at least 1.');
      return;
    }
    if (!validPrice) {
      Alert.alert('Validation', 'Please enter a valid price (₹).');
      return;
    }
    const paise = toPaise(parsedPrice);
    onSave(makeBillItem(item!.id, name.trim(), parsedQty, fromPaise(paise), item?.confidence));
  }

  return (
    <Modal
      visible={item !== null}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={modal.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={modal.sheet}>
          <View style={modal.handle} />

          {/* Title */}
          <View style={modal.titleRow}>
            <Text style={modal.title}>{isNew ? 'Add Item' : 'Edit Item'}</Text>
            <TouchableOpacity onPress={onClose} style={modal.closeBtn}>
              <X size={20} color={Colors.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          {/* Item name */}
          <View style={modal.fieldGroup}>
            <Text style={modal.label}>Item Name</Text>
            <TextInput
              style={modal.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Chicken Biryani"
              placeholderTextColor={Colors.textMuted}
              returnKeyType="next"
              autoFocus={isNew}
            />
          </View>

          {/* Qty + Price row */}
          <View style={modal.fieldRow}>
            <View style={[modal.fieldGroup, { flex: 1 }]}>
              <Text style={modal.label}>Qty</Text>
              <TextInput
                style={modal.input}
                value={qty}
                onChangeText={setQty}
                keyboardType="number-pad"
                placeholder="1"
                placeholderTextColor={Colors.textMuted}
                returnKeyType="next"
              />
            </View>
            <View style={[modal.fieldGroup, { flex: 2 }]}>
              <Text style={modal.label}>Unit Price (₹)</Text>
              <TextInput
                style={modal.input}
                value={price}
                onChangeText={setPrice}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={Colors.textMuted}
                returnKeyType="done"
                onSubmitEditing={handleSave}
              />
            </View>
          </View>

          {/* Live line-total preview */}
          {previewPaise !== null && (
            <View style={modal.preview}>
              <Text style={modal.previewLabel}>Line total</Text>
              <Text style={modal.previewValue}>{formatPaise(previewPaise)}</Text>
            </View>
          )}

          {/* Action buttons */}
          <View style={modal.actionRow}>
            <TouchableOpacity style={modal.cancelBtn} onPress={onClose} activeOpacity={0.75}>
              <Text style={modal.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={modal.saveBtn} onPress={handleSave} activeOpacity={0.85}>
              <Check size={17} color={Colors.white} strokeWidth={2.5} />
              <Text style={modal.saveText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const modal = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'android' ? 32 : 40,
    gap: 16,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 4,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:    { fontSize: 18, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.3 },
  closeBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  fieldGroup: { gap: 6 },
  fieldRow:  { flexDirection: 'row', gap: 12 },
  label: { fontSize: 11, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  input: {
    backgroundColor: Colors.background,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  preview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.primaryLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  previewLabel: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  previewValue: { fontSize: 15, fontWeight: '800', color: Colors.primary },
  actionRow:  { flexDirection: 'row', gap: 12 },
  cancelBtn:  { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  saveBtn:    { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 12, backgroundColor: Colors.primary },
  saveText:   { fontSize: 15, fontWeight: '700', color: Colors.white },
});

// ─────────────────────────────────────────────────────────────────────────────
// Bill Validation Card
// ─────────────────────────────────────────────────────────────────────────────

interface ValidationCardProps {
  computedPaise: number;
  detectedPaise: number | null;
  detectedGstPaise: number | null;
  detectedDiscountPaise: number | null;
  detectedServiceChargePaise: number | null;
  detectedGrandTotalPaise: number | null;
  tipPaise: number;
  totalPaise: number;
  validationWarnings?: BillValidationWarning[];
}

function ValidationCard({
  computedPaise,
  detectedPaise,
  detectedGstPaise,
  detectedDiscountPaise,
  detectedServiceChargePaise,
  detectedGrandTotalPaise,
  tipPaise,
  totalPaise,
  validationWarnings,
}: ValidationCardProps) {
  const hasMismatch =
    detectedPaise !== null && Math.abs(computedPaise - detectedPaise) > 50; // >50 paise diff
  const diff = detectedPaise !== null ? computedPaise - detectedPaise : 0;
  const hasBackendWarnings = (validationWarnings?.length ?? 0) > 0;

  return (
    <View style={vCard.card}>
      {/* Header */}
      <View style={vCard.header}>
        {hasMismatch || hasBackendWarnings ? (
          <AlertTriangle size={16} color="#b45309" strokeWidth={2} />
        ) : (
          <ShieldCheck size={16} color={Colors.primary} strokeWidth={2} />
        )}
        <Text style={[vCard.headerTitle, (hasMismatch || hasBackendWarnings) && vCard.headerTitleWarn]}>
          {hasMismatch || hasBackendWarnings ? 'Bill Validation — Issues Found' : 'Bill Validation'}
        </Text>
      </View>

      {/* Rows */}
      <View style={vCard.body}>
        <VRow label="Items subtotal (computed)" value={formatPaise(computedPaise)} />

        {detectedPaise !== null ? (
          <VRow label="Subtotal on bill (detected)" value={formatPaise(detectedPaise)} />
        ) : (
          <VRow label="Subtotal on bill" value="Not detected" muted />
        )}

        {hasMismatch && (
          <VRow
            label={`Difference (${diff > 0 ? 'over' : 'under'})`}
            value={`${diff > 0 ? '+' : '−'}${formatPaise(Math.abs(diff))}`}
            warn
          />
        )}

        <View style={vCard.divider} />

        {/* GST — show detected value from bill when available */}
        {detectedGstPaise !== null && detectedGstPaise !== undefined ? (
          <VRow label="GST (on bill)" value={formatPaise(detectedGstPaise)} />
        ) : (
          <VRow label="GST (estimated 5%)" value={formatPaise(applyRatePaise(computedPaise, 0.05))} />
        )}

        {/* Discount */}
        {detectedDiscountPaise !== null && detectedDiscountPaise !== undefined && detectedDiscountPaise > 0 && (
          <VRow label="Discount" value={`−${formatPaise(detectedDiscountPaise)}`} />
        )}

        {/* Service charge */}
        {detectedServiceChargePaise !== null && detectedServiceChargePaise !== undefined && detectedServiceChargePaise > 0 && (
          <VRow label="Service charge" value={formatPaise(detectedServiceChargePaise)} />
        )}

        {tipPaise > 0 && <VRow label="Tip" value={formatPaise(tipPaise)} />}

        <View style={vCard.divider} />

        {/* Grand total */}
        <VRow label="Grand Total" value={formatPaise(totalPaise)} bold />

        {/* Detected grand total for comparison */}
        {detectedGrandTotalPaise !== null && detectedGrandTotalPaise !== undefined && (
          <VRow label="Grand total on bill" value={formatPaise(detectedGrandTotalPaise)} muted />
        )}
      </View>

      {/* Backend validation warnings */}
      {hasBackendWarnings && validationWarnings!.map((w, i) => (
        <View key={i} style={vCard.hint}>
          <Info size={13} color="#92400e" strokeWidth={2} />
          <Text style={vCard.hintText}>{w.message}</Text>
        </View>
      ))}

      {/* Mismatch hint */}
      {hasMismatch && !hasBackendWarnings && (
        <View style={vCard.hint}>
          <Info size={13} color="#92400e" strokeWidth={2} />
          <Text style={vCard.hintText}>
            Edit items above to correct the discrepancy before splitting.
          </Text>
        </View>
      )}
    </View>
  );
}

function VRow({
  label, value, bold = false, warn = false, muted = false,
}: {
  label: string; value: string; bold?: boolean; warn?: boolean; muted?: boolean;
}) {
  return (
    <View style={vCard.row}>
      <Text style={[vCard.label, muted && vCard.labelMuted]}>{label}</Text>
      <Text
        style={[
          vCard.value,
          bold && vCard.valueBold,
          warn && vCard.valueWarn,
          muted && vCard.labelMuted,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const vCard = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.border,
    overflow: 'hidden',
    ...Platform.select({ android: { elevation: 2 } }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.background,
  },
  headerTitle:     { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  headerTitleWarn: { color: '#92400e' },
  body:    { paddingHorizontal: 16, paddingVertical: 12, gap: 9 },
  row:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label:   { fontSize: 13, color: Colors.textSecondary },
  labelMuted: { color: Colors.textMuted, fontStyle: 'italic' },
  value:   { fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  valueBold: { fontSize: 15, fontWeight: '800', color: Colors.primary },
  valueWarn: { color: '#b45309' },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 3 },
  hint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#fffbeb',
    borderTopWidth: 1,
    borderTopColor: '#fde68a',
    padding: 12,
  },
  hintText: { flex: 1, fontSize: 12, color: '#78350f', lineHeight: 17 },
});

// ─────────────────────────────────────────────────────────────────────────────
// ItemRow (single editable row in the items table)
// ─────────────────────────────────────────────────────────────────────────────

interface ItemRowProps {
  item: BillItem;
  index: number;
  onEdit: (item: BillItem) => void;
  onDelete: (id: string) => void;
  isLast: boolean;
}

function ItemRow({ item, index, onEdit, onDelete, isLast }: ItemRowProps) {
  const linePaise = item.unitPricePaise * item.qty;
  const lowConf   = item.confidence !== undefined && item.confidence < 0.8;

  return (
    <View>
      <View style={[row.container, index % 2 === 1 && row.alt]}>

        {/* Index bubble */}
        <View style={row.indexBubble}>
          <Text style={row.indexText}>{index + 1}</Text>
        </View>

        {/* Name block */}
        <View style={row.nameWrap}>
          <View style={row.nameRow}>
            <Text style={row.name} numberOfLines={1}>{item.name}</Text>
            {lowConf && <Info size={11} color="#f59e0b" strokeWidth={2} />}
          </View>
          {/* Always show unit price + qty breakdown */}
          <Text style={row.meta}>
            {item.qty} × {formatPaise(item.unitPricePaise)}
          </Text>
        </View>

        {/* Line total */}
        <Text style={row.total}>{formatPaise(linePaise)}</Text>

        {/* Edit button */}
        <TouchableOpacity
          style={row.actionBtn}
          onPress={() => onEdit(item)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        >
          <Pencil size={14} color={Colors.primary} strokeWidth={2} />
        </TouchableOpacity>

        {/* Delete button */}
        <TouchableOpacity
          style={[row.actionBtn, row.deleteBtn]}
          onPress={() =>
            Alert.alert(
              'Delete item',
              `Remove "${item.name}"?`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => onDelete(item.id) },
              ],
            )
          }
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        >
          <Trash2 size={14} color="#ef4444" strokeWidth={2} />
        </TouchableOpacity>
      </View>
      {!isLast && <View style={row.divider} />}
    </View>
  );
}

const row = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 8,
  },
  alt:         { backgroundColor: '#fafafa' },
  divider:     { height: 1, backgroundColor: Colors.border, marginHorizontal: 14 },
  indexBubble: { width: 22, height: 22, borderRadius: 6, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  indexText:   { fontSize: 10, fontWeight: '700', color: Colors.primary },
  nameWrap:    { flex: 1, gap: 2 },
  nameRow:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name:        { fontSize: 13, fontWeight: '500', color: Colors.textPrimary, flexShrink: 1 },
  meta:        { fontSize: 11, color: Colors.textMuted },
  total:       { fontSize: 13, fontWeight: '700', color: Colors.textPrimary, minWidth: 72, textAlign: 'right' },
  actionBtn:   { width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  deleteBtn:   { backgroundColor: '#fee2e2' },
});

// ─────────────────────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────────────────────

export default function ResultsScreen() {
  const router      = useRouter();
  const { uri }     = useLocalSearchParams<{ uri?: string }>();
  const { getBill } = useBillStore();

  /* Hydrate from store on first render */
  const storedBill         = getBill();
  const [items, setItems]  = useState<BillItem[]>(storedBill?.items ?? []);
  const isDemoData         = storedBill?.isDemoData ?? true;
  const detectedPaise      = storedBill?.detectedSubtotalPaise ?? null;
  const detectedGstPaise   = storedBill?.detectedGstPaise ?? null;
  const detectedDiscountPaise = storedBill?.detectedDiscountPaise ?? null;
  const detectedServiceChargePaise = storedBill?.detectedServiceChargePaise ?? null;
  const detectedGrandTotalPaise = storedBill?.detectedGrandTotalPaise ?? null;
  const restaurantName     = storedBill?.restaurantName ?? null;
  const overallConfidence  = storedBill?.overallConfidence;
  const validationWarnings = storedBill?.validationWarnings;
  const geminiWarnings     = storedBill?.geminiWarnings;

  const [selectedTip, setSelectedTip] = useState<TipOption>(0);
  const [editTarget,  setEditTarget]  = useState<BillItem | null>(null);

  /* ── Paise calculations ──────────────────────────────────────────────── */
  const subtotalPaise = computeSubtotalPaise(items);

  // Use detected GST from the bill when available; otherwise estimate at 5%
  const gstPaise = (detectedGstPaise !== null && detectedGstPaise !== undefined)
    ? detectedGstPaise
    : computeGSTPaise(subtotalPaise);

  const tipPaise      = computeTipPaise(subtotalPaise, selectedTip);

  // Grand total = subtotal + gst + service_charge + tip - discount
  const serviceChargePaise = detectedServiceChargePaise ?? 0;
  const discountPaise = detectedDiscountPaise ?? 0;
  const totalPaise    = subtotalPaise + gstPaise + serviceChargePaise + tipPaise - discountPaise;

  /* ── Item mutations ─────────────────────────────────────────────────── */
  const handleSaveItem = useCallback((updated: BillItem) => {
    setItems(prev => {
      const idx = prev.findIndex(i => i.id === updated.id);
      if (idx === -1) return [...prev, updated];
      const next = [...prev];
      next[idx] = updated;
      return next;
    });
    setEditTarget(null);
  }, []);

  const handleDelete = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  }, []);

  const handleAdd = useCallback(() => {
    setEditTarget(makeBlankItem());
  }, []);

  /* ── Render ──────────────────────────────────────────────────────────── */
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar style="dark" />

      <ItemModal
        item={editTarget}
        onSave={handleSaveItem}
        onClose={() => setEditTarget(null)}
      />

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity style={s.iconBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <ArrowLeft size={22} color={Colors.textPrimary} strokeWidth={2} />
        </TouchableOpacity>
        <View style={s.headerMid}>
          <Text style={s.heading}>Extracted Items</Text>
          <View style={s.badge}>
            <CheckCircle2 size={12} color={Colors.primary} strokeWidth={2.5} />
            <Text style={s.badgeText}>
              {isDemoData ? 'Demo data · INR' : 'AI Extracted · INR'}
            </Text>
          </View>
        </View>
        <TouchableOpacity style={[s.iconBtn, s.addBtn]} onPress={handleAdd} activeOpacity={0.7}>
          <Plus size={20} color={Colors.primary} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Bill image preview ── */}
        {uri ? (
          <View style={s.previewRow}>
            <Image source={{ uri }} style={s.previewThumb} resizeMode="cover" />
            <View style={s.previewMeta}>
              <View style={s.chip}>
                <Sparkles size={11} color={Colors.primary} strokeWidth={2} />
                <Text style={s.chipText}>{isDemoData ? 'Demo Mode' : 'AI Extracted'}</Text>
              </View>
              <Text style={s.previewCount}>{items.length} items found</Text>
              <Text style={s.previewHint}>
                {restaurantName
                  ? restaurantName
                  : isDemoData
                    ? 'Sample Indian restaurant bill'
                    : 'Tap ✏️ to edit · 🗑 to delete'}
              </Text>
              {!isDemoData && overallConfidence !== undefined && (
                <Text style={s.previewConfidence}>
                  Confidence: {Math.round(overallConfidence * 100)}%
                </Text>
              )}
            </View>
          </View>
        ) : null}

        {/* ── Demo notice (only for demo data) ── */}
        {isDemoData && (
          <View style={s.notice}>
            <Info size={14} color={Colors.primary} strokeWidth={2} />
            <Text style={s.noticeText}>
              Showing <Text style={{ fontWeight: '700' }}>sample Indian restaurant data</Text>.
              These items were NOT extracted from your image. Connect the backend to use real Gemini Vision OCR.
            </Text>
          </View>
        )}

        {/* ── Gemini warnings (from real OCR) ── */}
        {!isDemoData && geminiWarnings && geminiWarnings.length > 0 && (
          <View style={s.notice}>
            <Info size={14} color="#f59e0b" strokeWidth={2} />
            <Text style={[s.noticeText, { color: '#92400e' }]}>
              {geminiWarnings.join('\n')}
            </Text>
          </View>
        )}

        {/* ── Items card ── */}
        <View style={s.card}>
          {/* Card header */}
          <View style={s.cardHeader}>
            <Receipt size={16} color={Colors.textPrimary} strokeWidth={2} />
            <Text style={s.cardTitle}>Bill Items</Text>
            <Text style={s.cardCount}>{items.length} items</Text>
          </View>

          {/* Column labels */}
          <View style={s.colHeader}>
            <Text style={[s.colLabel, { flex: 1 }]}>Item · Qty × Price</Text>
            <Text style={[s.colLabel, { minWidth: 72, textAlign: 'right' }]}>Total</Text>
            <Text style={[s.colLabel, { width: 64, textAlign: 'center' }]}>Edit / Del</Text>
          </View>

          {/* Rows */}
          {items.length === 0 ? (
            <View style={s.emptyState}>
              <Text style={s.emptyText}>No items yet.</Text>
              <TouchableOpacity onPress={handleAdd} activeOpacity={0.8}>
                <Text style={s.emptyLink}>+ Add an item</Text>
              </TouchableOpacity>
            </View>
          ) : (
            items.map((item, idx) => (
              <ItemRow
                key={item.id}
                item={item}
                index={idx}
                onEdit={setEditTarget}
                onDelete={handleDelete}
                isLast={idx === items.length - 1}
              />
            ))
          )}

          {/* Add-item footer */}
          {items.length > 0 && (
            <TouchableOpacity style={s.addRow} onPress={handleAdd} activeOpacity={0.8}>
              <Plus size={15} color={Colors.primary} strokeWidth={2.5} />
              <Text style={s.addRowText}>Add another item</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Tip selector ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <IndianRupee size={16} color={Colors.textPrimary} strokeWidth={2} />
            <Text style={s.cardTitle}>Add a Tip</Text>
          </View>
          <View style={s.tipRow}>
            {TIP_OPTIONS.map(pct => (
              <TouchableOpacity
                key={pct}
                style={[s.tipChip, selectedTip === pct && s.tipChipActive]}
                onPress={() => setSelectedTip(pct)}
                activeOpacity={0.8}
              >
                <Text style={[s.tipText, selectedTip === pct && s.tipTextActive]}>
                  {pct === 0 ? 'No tip' : `${pct}%`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Validation + Summary card ── */}
        <ValidationCard
          computedPaise={subtotalPaise}
          detectedPaise={detectedPaise}
          detectedGstPaise={detectedGstPaise}
          detectedDiscountPaise={detectedDiscountPaise}
          detectedServiceChargePaise={detectedServiceChargePaise}
          detectedGrandTotalPaise={detectedGrandTotalPaise}
          tipPaise={tipPaise}
          totalPaise={totalPaise}
          validationWarnings={validationWarnings}
        />

        {/* ── Split Bill CTA ── */}
        <TouchableOpacity style={s.splitBtn} activeOpacity={0.88}>
          <Users size={20} color={Colors.white} strokeWidth={2} />
          <Text style={s.splitBtnText}>Split Bill</Text>
          <ChevronRight size={18} color={Colors.white} strokeWidth={2.5} />
        </TouchableOpacity>

        {/* ── Secondary actions ── */}
        <View style={s.secondaryRow}>
          <TouchableOpacity
            style={s.secondaryAction}
            onPress={() => router.replace('/scan')}
            activeOpacity={0.75}
          >
            <RotateCcw size={15} color={Colors.primary} strokeWidth={2} />
            <Text style={s.secondaryText}>Scan Another</Text>
          </TouchableOpacity>
          <View style={s.secondaryDivider} />
          <TouchableOpacity
            style={s.secondaryAction}
            onPress={() => router.replace('/')}
            activeOpacity={0.75}
          >
            <Text style={s.secondaryText}>Back to Home</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  /* Header */
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
  iconBtn: { width: 42, height: 42, borderRadius: 12, backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  addBtn:  { backgroundColor: Colors.primaryLight, borderColor: Colors.primaryLight },
  headerMid: { flex: 1, gap: 4 },
  heading:   { fontSize: 22, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.3 },
  badge:     { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.primaryLight, borderRadius: 20, paddingVertical: 3, paddingHorizontal: 10, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11, fontWeight: '600', color: Colors.primary },

  /* Scroll */
  scroll: { paddingHorizontal: 20, paddingBottom: 44, gap: 14 },

  /* Image preview */
  previewRow:   { flexDirection: 'row', backgroundColor: Colors.cardBg, borderRadius: 16, borderWidth: 1.5, borderColor: Colors.border, gap: 14, padding: 12, alignItems: 'center', ...Platform.select({ android: { elevation: 2 } }) },
  previewThumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: Colors.border },
  previewMeta:  { flex: 1, gap: 4 },
  chip:         { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primaryLight, borderRadius: 20, paddingVertical: 3, paddingHorizontal: 9, alignSelf: 'flex-start' },
  chipText:     { fontSize: 11, fontWeight: '600', color: Colors.primary },
  previewCount: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  previewHint:  { fontSize: 12, color: Colors.textSecondary },
  previewConfidence: { fontSize: 11, fontWeight: '600', color: Colors.primary, marginTop: 2 },

  /* Demo notice */
  notice:     { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: Colors.primaryLight, borderRadius: 12, padding: 12 },
  noticeText: { flex: 1, fontSize: 12, color: Colors.primary, lineHeight: 18, fontWeight: '500' },

  /* Cards */
  card:       { backgroundColor: Colors.cardBg, borderRadius: 16, borderWidth: 1.5, borderColor: Colors.border, overflow: 'hidden', ...Platform.select({ android: { elevation: 2 } }) },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: Colors.border },
  cardTitle:  { fontSize: 15, fontWeight: '700', color: Colors.textPrimary, flex: 1 },
  cardCount:  { fontSize: 12, fontWeight: '600', color: Colors.textMuted },

  /* Column headers */
  colHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 7, backgroundColor: Colors.background, gap: 8 },
  colLabel:  { fontSize: 10, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },

  /* Empty state */
  emptyState: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  emptyText:  { fontSize: 14, color: Colors.textSecondary },
  emptyLink:  { fontSize: 14, fontWeight: '700', color: Colors.primary },

  /* Add-item footer */
  addRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13, borderTopWidth: 1, borderTopColor: Colors.border },
  addRowText: { fontSize: 14, fontWeight: '600', color: Colors.primary },

  /* Tip */
  tipRow:     { flexDirection: 'row', padding: 16, gap: 8 },
  tipChip:    { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center' },
  tipChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tipText:    { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  tipTextActive: { color: Colors.white },

  /* Split CTA */
  splitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    gap: 10,
    marginTop: 4,
    ...Platform.select({
      android: { elevation: 4 },
      ios: { shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
    }),
  },
  splitBtnText: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '800', color: Colors.white, letterSpacing: 0.1 },

  /* Secondary actions */
  secondaryRow:    { flexDirection: 'row', backgroundColor: Colors.cardBg, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, overflow: 'hidden' },
  secondaryAction: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, gap: 7 },
  secondaryText:   { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  secondaryDivider:{ width: 1, backgroundColor: Colors.border, marginVertical: 10 },
});
