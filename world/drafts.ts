/** Exact draft confirmations shared by page, native cards and model tools. */
export interface DraftRef { draftId: string; revision: number }
export interface DraftConfirmation extends DraftRef { generation: number; headless?: boolean; controller?: boolean }

export function isDraftRef(value: unknown): value is DraftRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ref = value as Partial<DraftRef>;
  return typeof ref.draftId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(ref.draftId) &&
    Number.isSafeInteger(ref.revision) && ref.revision! > 0;
}
