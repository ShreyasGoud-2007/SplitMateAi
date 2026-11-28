import type { BillItem } from '@/types/bill';
import type { ItemAssignment } from '@/types/itemAssignment';

export function getItemTotalPaise(item: BillItem): number {
  return Math.max(0, item.lineTotalPaise);
}

export function getItemAllocationAmounts(
  item: BillItem,
  assignment: ItemAssignment | undefined,
  participantIds: string[],
): Record<string, number> {
  const amounts: Record<string, number> = {};
  const validIds = new Set(participantIds);
  const totalPaise = getItemTotalPaise(item);

  if (!assignment || totalPaise === 0) return amounts;

  if (assignment.method === 'single') {
    if (assignment.participantId && validIds.has(assignment.participantId)) {
      amounts[assignment.participantId] = totalPaise;
    }
    return amounts;
  }

  if (assignment.method === 'shared') {
    const selectedIds = [...new Set(assignment.participantIds)].filter((id) => validIds.has(id));
    if (selectedIds.length === 0) return amounts;

    const baseShare = Math.floor(totalPaise / selectedIds.length);
    const remainder = totalPaise % selectedIds.length;
    selectedIds.forEach((id, index) => {
      amounts[id] = baseShare + (index < remainder ? 1 : 0);
    });
    return amounts;
  }

  let remainingQuantity = Math.max(0, item.qty);
  let remainingPaise = totalPaise;
  const allocatedIds: string[] = [];

  for (const id of participantIds) {
    const requested = assignment.quantities[id] ?? 0;
    if (!Number.isFinite(requested) || requested <= 0 || remainingQuantity <= 0) continue;

    const quantity = Math.min(requested, remainingQuantity);
    const share = Math.min(
      remainingPaise,
      Math.round(item.unitPricePaise * quantity),
    );

    if (share > 0) {
      amounts[id] = share;
      allocatedIds.push(id);
      remainingPaise -= share;
    }
    remainingQuantity = Math.max(0, remainingQuantity - quantity);
  }

  if (remainingQuantity <= 1e-8 && remainingPaise > 0 && allocatedIds.length > 0) {
    const lastId = allocatedIds[allocatedIds.length - 1];
    amounts[lastId] += remainingPaise;
  }

  return amounts;
}

export function getItemAssignedPaise(
  item: BillItem,
  assignment: ItemAssignment | undefined,
  participantIds: string[],
): number {
  return Object.values(getItemAllocationAmounts(item, assignment, participantIds))
    .reduce((total, amount) => total + amount, 0);
}

export function getItemAssignmentStatus(
  item: BillItem,
  assignment: ItemAssignment | undefined,
  participantIds: string[],
): 'unassigned' | 'partial' | 'assigned' {
  const total = getItemTotalPaise(item);
  const assigned = getItemAssignedPaise(item, assignment, participantIds);
  if (assigned <= 0) return 'unassigned';
  return assigned >= total ? 'assigned' : 'partial';
}

export function updateQuantityAllocation(
  assignment: ItemAssignment | undefined,
  participantId: string,
  delta: number,
  purchasedQuantity: number,
): ItemAssignment {
  const current: Record<string, number> =
    assignment?.method === 'quantity' ? { ...assignment.quantities } : {};
  const allocatedElsewhere = Object.entries(current)
    .filter(([id]) => id !== participantId)
    .reduce((total, [, quantity]) => total + Math.max(0, quantity), 0);
  const currentQuantity = Math.max(0, current[participantId] ?? 0);
  const available = Math.max(0, purchasedQuantity - allocatedElsewhere);
  const nextQuantity = Math.min(
    available,
    Math.max(0, currentQuantity + delta),
  );

  if (nextQuantity === 0) delete current[participantId];
  else current[participantId] = nextQuantity;

  return { method: 'quantity', quantities: current };
}
