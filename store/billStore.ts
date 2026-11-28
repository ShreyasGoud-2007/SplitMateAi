/**
 * BillStore — lightweight React context that holds the active ExtractedBill
 * between the Review screen (which triggers extraction) and the Results screen
 * (which displays and edits the bill).
 *
 * This avoids encoding large item arrays in URL params and gives both screens
 * a shared mutable reference.
 */

import { buildDemoBill, type BillImageMetadata, type ExtractedBill } from '@/types/bill';
import type { ItemAssignments } from '@/types/itemAssignment';
import type { SplitSession } from '@/types/splitSession';
import type { OCRExtractResponse } from '@/utils/api';
import { adaptOCRResponseToBill } from '@/utils/billAdapters';
import { normalizeBill } from '@/utils/billNormalization';
import React, { createContext, useCallback, useContext, useRef } from 'react';

interface BillStoreContextValue {
  /** Set the active bill (called from review.tsx after extraction). */
  setBill: (bill: ExtractedBill) => void;
  /** Get the active bill (called from results.tsx on mount). */
  getBill: () => ExtractedBill | null;
  /** Hand off a selected image URI between scan routes without URL decoding. */
  setPendingImageUri: (uri: string | null) => void;
  getPendingImageUri: () => string | null;
  /** Store the active group bill-splitting session. */
  setSplitSession: (session: SplitSession) => void;
  /** Get the active group bill-splitting session. */
  getSplitSession: () => SplitSession | null;
  /** Store item assignments for the active bill. */
  setItemAssignments: (assignments: ItemAssignments) => void;
  /** Get item assignments for the active bill. */
  getItemAssignments: () => ItemAssignments;
}

const BillStoreContext = createContext<BillStoreContextValue | null>(null);

export function BillStoreProvider({ children }: { children: React.ReactNode }) {
  // useRef so mutations don't cause re-renders of the provider tree
  const billRef = useRef<ExtractedBill | null>(null);
  const pendingImageUriRef = useRef<string | null>(null);
  const splitSessionRef = useRef<SplitSession | null>(null);
  const itemAssignmentsRef = useRef<ItemAssignments>({});

  const setBill = useCallback((bill: ExtractedBill) => {
    const normalized = normalizeBill(bill);
    if (billRef.current && billRef.current.id !== normalized.id) {
      itemAssignmentsRef.current = {};
    }
    billRef.current = normalized;
  }, []);

  const getBill = useCallback(() => billRef.current, []);
  const setPendingImageUri = useCallback((uri: string | null) => {
    pendingImageUriRef.current = uri;
  }, []);
  const getPendingImageUri = useCallback(() => pendingImageUriRef.current, []);
  const setSplitSession = useCallback((session: SplitSession) => {
    splitSessionRef.current = session;
  }, []);
  const getSplitSession = useCallback(() => splitSessionRef.current, []);
  const setItemAssignments = useCallback((assignments: ItemAssignments) => {
    itemAssignmentsRef.current = assignments;
  }, []);
  const getItemAssignments = useCallback(() => itemAssignmentsRef.current, []);

  return React.createElement(
    BillStoreContext.Provider,
    {
      value: {
        setBill,
        getBill,
        setPendingImageUri,
        getPendingImageUri,
        setSplitSession,
        getSplitSession,
        setItemAssignments,
        getItemAssignments,
      },
    },
    children,
  );
}

export function useBillStore(): BillStoreContextValue {
  const ctx = useContext(BillStoreContext);
  if (!ctx) {
    throw new Error('useBillStore must be used inside <BillStoreProvider>');
  }
  return ctx;
}

/**
 * Convenience: build and store a demo bill for a given image URI.
 * Returns the bill so the caller can inspect it immediately.
 */
export function storeDemoBill(
  setBill: BillStoreContextValue['setBill'],
  imageUri: string,
): ExtractedBill {
  const bill = buildDemoBill(imageUri);
  setBill(bill);
  return bill;
}

/**
 * Map a real OCR API response to an ExtractedBill and store it.
 *
 * Converts the backend's snake_case fields to the frontend's camelCase
 * and maps each OCRItem to a BillItem with paise values.
 */
export function storeOCRResult(
  setBill: BillStoreContextValue['setBill'],
  imageUri: string,
  ocr: OCRExtractResponse,
): ExtractedBill {
  const imageMetadata: BillImageMetadata = { uri: imageUri };
  const bill = adaptOCRResponseToBill(ocr, imageMetadata);
  setBill(bill);
  return bill;
}
