import type { TaskNode } from '../task-tree/taskTreeTypes';
import { readStorageValue, removeStorageValue, writeStorageValue } from './storageClient';

export const POPUP_DRAFT_STORAGE_KEY = 'ygEasyPopupDraft';
export const POPUP_FORM_DRAFT_STORAGE_KEY = 'ygEasyPopupFormDraft';

export type PopupDraft = {
  root: TaskNode;
  savedAt: string;
};

export type PopupFormDraft<TFormState, TStickerDraft> = {
  selectedProjectId: string;
  selectedBoardId: string;
  selectedColumnId: string;
  includeChild: boolean;
  parentForm: TFormState;
  childForm: TFormState;
  parentStickerDraft: TStickerDraft;
  childStickerDraft: TStickerDraft;
  savedAt: string;
};

export async function readPopupDraft(): Promise<PopupDraft | null> {
  return readStorageValue<PopupDraft | null>(POPUP_DRAFT_STORAGE_KEY, null);
}

export async function writePopupDraft(root: TaskNode): Promise<void> {
  await writeStorageValue<PopupDraft>(POPUP_DRAFT_STORAGE_KEY, {
    root,
    savedAt: new Date().toISOString(),
  });
}

export async function readPopupFormDraft<TFormState, TStickerDraft>(): Promise<PopupFormDraft<TFormState, TStickerDraft> | null> {
  return readStorageValue<PopupFormDraft<TFormState, TStickerDraft> | null>(POPUP_FORM_DRAFT_STORAGE_KEY, null);
}

export async function writePopupFormDraft<TFormState, TStickerDraft>(
  draft: Omit<PopupFormDraft<TFormState, TStickerDraft>, 'savedAt'>,
): Promise<void> {
  await writeStorageValue<PopupFormDraft<TFormState, TStickerDraft>>(POPUP_FORM_DRAFT_STORAGE_KEY, {
    ...draft,
    savedAt: new Date().toISOString(),
  });
}

export async function clearPopupFormDraft(): Promise<void> {
  await removeStorageValue(POPUP_FORM_DRAFT_STORAGE_KEY);
}
