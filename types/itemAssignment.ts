export type AssignmentMethod = 'quantity' | 'shared' | 'single';

export interface QuantityItemAssignment {
  method: 'quantity';
  quantities: Record<string, number>;
}

export interface SharedItemAssignment {
  method: 'shared';
  participantIds: string[];
}

export interface SingleItemAssignment {
  method: 'single';
  participantId: string | null;
}

export type ItemAssignment =
  | QuantityItemAssignment
  | SharedItemAssignment
  | SingleItemAssignment;

export type ItemAssignments = Record<string, ItemAssignment>;
