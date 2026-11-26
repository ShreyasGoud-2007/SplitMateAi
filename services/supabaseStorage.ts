import type {
  BillImageMetadata,
  BillSource,
  BillValidationWarning,
  CanonicalBill,
} from '@/types/bill';
import type { ItemAssignments, AssignmentMethod } from '@/types/itemAssignment';
import { BILL_CURRENCIES, type SplitSession } from '@/types/splitSession';
import { getItemAllocationAmounts } from '@/utils/itemAssignments';
import { normalizeBill } from '@/utils/billNormalization';
import { getSupabaseClient } from '@/utils/supabase';

export interface SavedSplitSessionSummary {
  id: string;
  groupName: string;
  restaurantName: string | null;
  currency: SplitSession['currency'];
  source: BillSource;
  totalPaise: number;
  participantCount: number;
  createdAt: string;
}

export interface LoadedSplitSession {
  session: SplitSession;
  bill: CanonicalBill;
  assignments: ItemAssignments;
}

export interface SplitSessionSavePayload {
  group: {
    client_id: string;
    name: string;
    restaurant_name: string | null;
    currency: string;
    created_at: string;
  };
  participants: {
    client_id: string;
    name: string;
    is_current_user: boolean;
    sort_order: number;
  }[];
  bill: {
    client_id: string;
    restaurant_name: string | null;
    source: BillSource;
    subtotal_paise: number;
    tax_paise: number;
    total_paise: number;
    currency: string;
    image_metadata: Record<string, unknown> | null;
    metadata: Record<string, unknown>;
    created_at: string;
    items: {
      client_id: string;
      name: string;
      quantity: number;
      unit_price_paise: number;
      total_paise: number;
      assignments: {
        participant_client_id: string;
        assigned_quantity: number | null;
        assigned_amount_paise: number;
        assignment_method: AssignmentMethod;
      }[];
    }[];
  };
}

export class SplitPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SplitPersistenceError';
  }
}

function assertAmount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SplitPersistenceError(`${label} must be a non-negative integer number of paise.`);
  }
}

function persistentImageMetadata(
  metadata: BillImageMetadata | undefined,
): Record<string, unknown> | null {
  if (!metadata) return null;
  const safeUri =
    metadata.uri && /^https?:\/\//i.test(metadata.uri)
      ? metadata.uri
      : undefined;
  return {
    ...(safeUri ? { uri: safeUri } : {}),
    ...(metadata.originalFileName ? { originalFileName: metadata.originalFileName } : {}),
    ...(metadata.mimeType ? { mimeType: metadata.mimeType } : {}),
    ...(metadata.source ? { source: metadata.source } : {}),
    ...(metadata.storagePath ? { storagePath: metadata.storagePath } : {}),
    ...(metadata.uploadedAt ? { uploadedAt: metadata.uploadedAt } : {}),
  };
}

export function buildSplitSessionSavePayload(
  session: SplitSession,
  inputBill: CanonicalBill,
  assignments: ItemAssignments,
): SplitSessionSavePayload {
  const bill = normalizeBill(inputBill);
  if (!session.id.trim() || !session.groupName.trim()) {
    throw new SplitPersistenceError('A saved split needs a group ID and group name.');
  }
  if (session.participants.length === 0) {
    throw new SplitPersistenceError('Add at least one participant before saving this split.');
  }

  const participantIds = session.participants.map(({ id }) => id);
  const participantNames = session.participants.map(({ name }) => name.trim().toLocaleLowerCase());
  if (
    participantIds.some((id) => !id.trim()) ||
    new Set(participantIds).size !== participantIds.length
  ) {
    throw new SplitPersistenceError('Participant IDs must be non-empty and unique within a split.');
  }
  if (
    participantNames.some((name) => !name) ||
    new Set(participantNames).size !== participantNames.length
  ) {
    throw new SplitPersistenceError('Participant names must be non-empty and unique within a split.');
  }
  if (!BILL_CURRENCIES.some(({ code }) => code === session.currency)) {
    throw new SplitPersistenceError('The split currency is invalid.');
  }
  const billItemIds = new Set(bill.items.map(({ id }) => id));
  if (Object.keys(assignments).some((itemId) => !billItemIds.has(itemId))) {
    throw new SplitPersistenceError('Assignments contain an item that is not on this bill.');
  }

  for (const item of bill.items) {
    assertAmount(item.unitPricePaise, `Unit price for "${item.name}"`);
    assertAmount(item.lineTotalPaise, `Line total for "${item.name}"`);
  }
  assertAmount(bill.subtotalPaise, 'Bill subtotal');
  assertAmount(bill.taxPaise, 'Bill tax');
  assertAmount(bill.totalPaise, 'Bill total');

  const items = bill.items.map((item) => {
    const assignment = assignments[item.id];
    if (
      assignment?.method === 'single' &&
      (typeof assignment.participantId !== 'string' ||
        !participantIds.includes(assignment.participantId))
    ) {
      throw new SplitPersistenceError(`"${item.name}" is assigned to an unknown participant.`);
    }
    if (assignment?.method === 'shared') {
      if (
        assignment.participantIds.length === 0 ||
        new Set(assignment.participantIds).size !== assignment.participantIds.length ||
        assignment.participantIds.some((id) => !participantIds.includes(id))
      ) {
        throw new SplitPersistenceError(`"${item.name}" has an invalid shared participant list.`);
      }
    }
    if (assignment?.method === 'quantity') {
      let allocatedQuantity = 0;
      for (const [participantId, quantity] of Object.entries(assignment.quantities)) {
        if (!participantIds.includes(participantId)) {
          throw new SplitPersistenceError(`"${item.name}" has an allocation for an unknown participant.`);
        }
        if (!Number.isFinite(quantity) || quantity < 0) {
          throw new SplitPersistenceError(`"${item.name}" has an invalid allocated quantity.`);
        }
        allocatedQuantity += quantity;
      }
      if (allocatedQuantity > item.qty + 1e-8) {
        throw new SplitPersistenceError(`Allocated quantity exceeds the purchased quantity for "${item.name}".`);
      }
    }
    const allocationAmounts = getItemAllocationAmounts(item, assignment, participantIds);
    const allocatedPaise = Object.values(allocationAmounts).reduce((sum, amount) => sum + amount, 0);
    if (allocatedPaise > item.lineTotalPaise) {
      throw new SplitPersistenceError(`Assignments exceed the total for "${item.name}".`);
    }

    return {
      client_id: item.id,
      name: item.name,
      quantity: item.qty,
      unit_price_paise: item.unitPricePaise,
      total_paise: item.lineTotalPaise,
      assignments: Object.entries(allocationAmounts)
        .filter(([, amount]) => amount > 0)
        .map(([participantId, amount]) => {
          let assignedQuantity: number | null = null;
          if (assignment?.method === 'quantity') {
            assignedQuantity = assignment.quantities[participantId] ?? 0;
          } else if (assignment?.method === 'single') {
            assignedQuantity = item.qty;
          }
          return {
            participant_client_id: participantId,
            assigned_quantity: assignedQuantity,
            assigned_amount_paise: amount,
            assignment_method: assignment?.method ?? 'quantity',
          };
        }),
    };
  });
  const assignedBillPaise = items.reduce(
    (sum, item) => sum + item.assignments.reduce(
      (itemSum, assignment) => itemSum + assignment.assigned_amount_paise,
      0,
    ),
    0,
  );
  if (assignedBillPaise > bill.totalPaise) {
    throw new SplitPersistenceError('Assigned item amounts cannot exceed the bill total.');
  }

  return {
    group: {
      client_id: session.id,
      name: session.groupName.trim(),
      restaurant_name: session.restaurantName?.trim() || null,
      currency: session.currency,
      created_at: session.createdAt,
    },
    participants: session.participants.map((participant, index) => ({
      client_id: participant.id,
      name: participant.name.trim(),
      is_current_user: participant.isCurrentUser,
      sort_order: index,
    })),
    bill: {
      client_id: bill.id,
      restaurant_name: bill.restaurantName?.trim() || session.restaurantName?.trim() || null,
      source: bill.source,
      subtotal_paise: bill.subtotalPaise,
      tax_paise: bill.taxPaise,
      total_paise: bill.totalPaise,
      currency: bill.currency,
      image_metadata: persistentImageMetadata(bill.imageMetadata),
      metadata: {
        ...bill.metadata,
        detectedSubtotalPaise: bill.detectedSubtotalPaise,
        detectedGstPaise: bill.detectedGstPaise,
        detectedDiscountPaise: bill.detectedDiscountPaise,
        detectedServiceChargePaise: bill.detectedServiceChargePaise,
        detectedGrandTotalPaise: bill.detectedGrandTotalPaise,
        detectedCurrency: bill.detectedCurrency,
        apiValidationWarnings: bill.validationWarnings ?? null,
        ...(bill.hasMismatch !== undefined ? { hasMismatch: bill.hasMismatch } : {}),
        ...(bill.overallConfidence !== undefined
          ? { overallConfidence: bill.overallConfidence }
          : {}),
        ...(bill.geminiWarnings ? { geminiWarnings: bill.geminiWarnings } : {}),
      },
      created_at: bill.createdAt,
      items,
    },
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SplitPersistenceError(`Saved ${label} data has an invalid shape.`);
  }
  return value as Record<string, unknown>;
}

function records(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new SplitPersistenceError(`Saved ${label} data is missing.`);
  return value.map((entry) => record(entry, label));
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new SplitPersistenceError(`Saved ${label} is invalid.`);
  return value;
}

function numberValue(value: unknown, label: string): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw new SplitPersistenceError(`Saved ${label} is invalid.`);
  return number;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function sourceValue(value: unknown): BillSource {
  if (value === 'ocr' || value === 'manual' || value === 'demo') return value;
  throw new SplitPersistenceError('Saved bill source is invalid.');
}

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function isBillValidationWarning(value: unknown): value is BillValidationWarning {
  const warning = jsonObject(value);
  if (!warning || typeof warning.code !== 'string' || typeof warning.message !== 'string') {
    return false;
  }
  return [
    warning.expected_paise,
    warning.actual_paise,
    warning.difference_paise,
  ].every((amount) =>
    amount === undefined ||
    amount === null ||
    (typeof amount === 'number' && Number.isFinite(amount)),
  );
}

export function reconstructSplitSession(rowValue: unknown): LoadedSplitSession {
  const row = record(rowValue, 'group');
  const participantRows = records(row.participants, 'participants');
  const billRows = records(row.bills, 'bill');
  if (billRows.length !== 1) {
    throw new SplitPersistenceError('A saved split must contain exactly one bill.');
  }

  const participants = participantRows
    .sort((left, right) =>
      numberValue(left.sort_order, 'participant order') -
      numberValue(right.sort_order, 'participant order'),
    )
    .map((participant) => ({
    id: stringValue(participant.client_id, 'participant ID'),
    name: stringValue(participant.name, 'participant name'),
    isCurrentUser: participant.is_current_user === true,
    }));
  const billRow = billRows[0];
  const itemRows = records(billRow.bill_items, 'bill items');
  const assignments: ItemAssignments = {};

  const items = itemRows.map((item) => {
    const clientId = stringValue(item.client_id, 'bill item ID');
    const itemAssignmentRows = records(item.item_assignments, 'item assignments').sort(
      (left, right) => {
        const leftParticipant = jsonObject(left.participants);
        const rightParticipant = jsonObject(right.participants);
        const leftOrder = participants.findIndex(
          ({ id }) => id === leftParticipant?.client_id,
        );
        const rightOrder = participants.findIndex(
          ({ id }) => id === rightParticipant?.client_id,
        );
        return leftOrder - rightOrder;
      },
    );
    if (itemAssignmentRows.length > 0) {
      const methodValue = itemAssignmentRows[0].assignment_method;
      if (methodValue === 'quantity') {
        const quantities: Record<string, number> = {};
        for (const assignmentRow of itemAssignmentRows) {
          const participant = record(assignmentRow.participants, 'assignment participant');
          quantities[stringValue(participant.client_id, 'assignment participant ID')] =
            numberValue(assignmentRow.assigned_quantity, 'assigned quantity');
        }
        assignments[clientId] = { method: 'quantity', quantities };
      } else if (methodValue === 'shared') {
        assignments[clientId] = {
          method: 'shared',
          participantIds: itemAssignmentRows.map((assignmentRow) => {
            const participant = record(assignmentRow.participants, 'assignment participant');
            return stringValue(participant.client_id, 'assignment participant ID');
          }),
        };
      } else if (methodValue === 'single') {
        const participant = record(itemAssignmentRows[0].participants, 'assignment participant');
        assignments[clientId] = {
          method: 'single',
          participantId: stringValue(participant.client_id, 'assignment participant ID'),
        };
      } else {
        throw new SplitPersistenceError('Saved assignment method is invalid.');
      }
    }

    return {
      id: clientId,
      name: stringValue(item.name, 'item name'),
      qty: numberValue(item.quantity, 'item quantity'),
      unitPricePaise: numberValue(item.unit_price_paise, 'unit price'),
      lineTotalPaise: numberValue(item.total_paise, 'item total'),
      unitPrice: numberValue(item.unit_price_paise, 'unit price') / 100,
    };
  });

  const metadataValue = jsonObject(billRow.image_metadata);
  const imageMetadata: BillImageMetadata | undefined = metadataValue
    ? {
        uri: nullableString(metadataValue.uri) ?? undefined,
        originalFileName: nullableString(metadataValue.originalFileName) ?? undefined,
        mimeType: nullableString(metadataValue.mimeType) ?? undefined,
        source:
          metadataValue.source === 'camera' ||
          metadataValue.source === 'gallery' ||
          metadataValue.source === 'imported' ||
          metadataValue.source === 'external'
            ? metadataValue.source
            : undefined,
        storagePath: nullableString(metadataValue.storagePath) ?? undefined,
        uploadedAt: nullableString(metadataValue.uploadedAt) ?? undefined,
      }
    : undefined;
  const source = sourceValue(billRow.source);
  const billMetadata = jsonObject(billRow.metadata) ?? {};
  const apiValidationWarnings = Array.isArray(billMetadata.apiValidationWarnings)
    ? billMetadata.apiValidationWarnings.filter(isBillValidationWarning)
    : undefined;
  const savedDetectedAmount = (key: string): number | null => {
    const value = billMetadata[key];
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
  };
  const bill = normalizeBill({
    id: stringValue(billRow.client_id, 'bill ID'),
    source,
    currency: stringValue(billRow.currency, 'bill currency'),
    restaurantName: nullableString(billRow.restaurant_name),
    imageUri: imageMetadata?.uri,
    imageMetadata,
    items,
    subtotalPaise: numberValue(billRow.subtotal_paise, 'subtotal'),
    taxPaise: numberValue(billRow.tax_paise, 'tax'),
    totalPaise: numberValue(billRow.total_paise, 'total'),
    detectedSubtotalPaise: savedDetectedAmount('detectedSubtotalPaise'),
    detectedGstPaise: savedDetectedAmount('detectedGstPaise'),
    detectedDiscountPaise: savedDetectedAmount('detectedDiscountPaise'),
    detectedServiceChargePaise: savedDetectedAmount('detectedServiceChargePaise'),
    detectedGrandTotalPaise: savedDetectedAmount('detectedGrandTotalPaise'),
    detectedCurrency:
      typeof billMetadata.detectedCurrency === 'string'
        ? billMetadata.detectedCurrency
        : stringValue(billRow.currency, 'bill currency'),
    createdAt: stringValue(billRow.created_at, 'bill creation time'),
    isDemoData: source === 'demo',
    metadata: billMetadata,
    validationWarnings: apiValidationWarnings,
    hasMismatch: billMetadata.hasMismatch === true,
    overallConfidence:
      typeof billMetadata.overallConfidence === 'number'
        ? billMetadata.overallConfidence
        : undefined,
    geminiWarnings: Array.isArray(billMetadata.geminiWarnings)
      ? billMetadata.geminiWarnings.filter((warning): warning is string => typeof warning === 'string')
      : undefined,
  });

  const groupCurrency = stringValue(row.currency, 'group currency');
  if (!BILL_CURRENCIES.some(({ code }) => code === groupCurrency)) {
    throw new SplitPersistenceError('Saved split currency is invalid.');
  }
  const session: SplitSession = {
    id: stringValue(row.client_id, 'group ID'),
    groupName: stringValue(row.name, 'group name'),
    restaurantName: nullableString(row.restaurant_name),
    currency: groupCurrency as SplitSession['currency'],
    participants,
    createdAt: stringValue(row.created_at, 'group creation time'),
  };

  return { session, bill, assignments };
}

async function authenticatedClient() {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw new SplitPersistenceError(`Could not check Supabase sign-in: ${error.message}`);
  if (!data.session) {
    throw new SplitPersistenceError(
      'Sign in to save or view your cloud split history.',
    );
  }
  return client;
}

export async function saveSplitSession(
  session: SplitSession,
  bill: CanonicalBill,
  assignments: ItemAssignments,
): Promise<void> {
  const client = await authenticatedClient();
  const payload = buildSplitSessionSavePayload(session, bill, assignments);
  const { error } = await client.rpc('save_split_session', { payload });
  if (error) throw new SplitPersistenceError(`Could not save this split: ${error.message}`);
}

const SESSION_SELECT =
  'id,client_id,name,restaurant_name,currency,created_at,participants(id,client_id,name,is_current_user,sort_order,created_at),bills(id,client_id,restaurant_name,source,subtotal_paise,tax_paise,total_paise,currency,image_metadata,created_at,metadata,bill_items(id,client_id,name,quantity,unit_price_paise,total_paise,item_assignments(id,assignment_method,assigned_quantity,assigned_amount_paise,participants(client_id))))';

export async function listSavedSplitSessions(): Promise<SavedSplitSessionSummary[]> {
  const client = await authenticatedClient();
  const { data, error } = await client
    .from('groups')
    .select(
      'client_id,name,restaurant_name,currency,created_at,participants(id),bills(source,total_paise,created_at)',
    )
    .order('created_at', { ascending: false });

  if (error) throw new SplitPersistenceError(`Could not load split history: ${error.message}`);
  const rows = records(data, 'history');

  return rows.map((row) => {
    const bills = records(row.bills, 'history bill');
    if (bills.length !== 1) {
      throw new SplitPersistenceError('A saved split must contain exactly one bill.');
    }
    const bill = bills[0];
    return {
      id: stringValue(row.client_id, 'group ID'),
      groupName: stringValue(row.name, 'group name'),
      restaurantName: nullableString(row.restaurant_name),
      currency: stringValue(row.currency, 'group currency') as SplitSession['currency'],
      source: sourceValue(bill.source),
      totalPaise: numberValue(bill.total_paise, 'bill total'),
      participantCount: records(row.participants, 'participants').length,
      createdAt: stringValue(row.created_at, 'group creation time'),
    };
  });
}

export async function getSavedSplitSession(clientId: string): Promise<LoadedSplitSession> {
  const client = await authenticatedClient();
  const { data, error } = await client
    .from('groups')
    .select(SESSION_SELECT)
    .eq('client_id', clientId)
    .order('sort_order', { referencedTable: 'participants', ascending: true })
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw new SplitPersistenceError('That saved split could not be found or you do not have access.');
    }
    throw new SplitPersistenceError(`Could not open this saved split: ${error.message}`);
  }
  return reconstructSplitSession(data);
}

export async function deleteSavedSplitSession(clientId: string): Promise<void> {
  const client = await authenticatedClient();
  const { data, error } = await client
    .from('groups')
    .delete()
    .eq('client_id', clientId)
    .select('id');

  if (error) throw new SplitPersistenceError(`Could not delete this split: ${error.message}`);
  if (!data || data.length === 0) {
    throw new SplitPersistenceError('That saved split could not be found or you do not have access.');
  }
}
