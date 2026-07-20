import type { YouGileStringSticker } from '../api/stickersApi';
import type { BoardStickerConfig } from '../storage/directoriesStorage';
import type { AddableStickerOption, ParentStickerConfig } from './stickerTypes';

const HIDDEN_ADDABLE_STICKER_NAMES = new Set(['Родитель', 'Регулярная задача']);

export function getAddableStickerOptions(
  boardId: string,
  stickers: YouGileStringSticker[],
  boardStickerConfig: BoardStickerConfig[],
): AddableStickerOption[] {
  const config = boardStickerConfig.find((item) => item.boardId === boardId);

  if (!config) {
    return [];
  }

  const customStickerIds = Array.isArray(config.custom) ? config.custom : [];
  const numericStickers = Array.isArray(config.numeric) ? config.numeric : [];
  const stickersById = new Map(stickers.map((sticker) => [sticker.id, sticker]));
  const stateStickerOptions: AddableStickerOption[] = customStickerIds
    .map((id) => stickersById.get(id))
    .filter((sticker): sticker is YouGileStringSticker => Boolean(sticker))
    .filter((sticker) => !HIDDEN_ADDABLE_STICKER_NAMES.has(sticker.name))
    .map((sticker) => ({
      kind: 'state',
      id: sticker.id,
      name: sticker.name,
      states: Array.isArray(sticker.states) ? sticker.states : [],
    }));

  const numericStickerOptions: AddableStickerOption[] = numericStickers
    .filter((sticker) => !HIDDEN_ADDABLE_STICKER_NAMES.has(sticker.title))
    .map((sticker) => ({
      kind: 'numeric',
      id: sticker.id,
      name: sticker.title,
    }));

  return [...stateStickerOptions, ...numericStickerOptions].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export function getParentStickerConfig(stickers: YouGileStringSticker[]): ParentStickerConfig {
  const parentSticker = stickers.find((sticker) => sticker.name === 'Родитель');
  const state = Array.isArray(parentSticker?.states) ? parentSticker.states[0] : undefined;

  if (!parentSticker || !state) {
    return null;
  }

  return {
    stickerId: parentSticker.id,
    stateId: state.id,
    name: parentSticker.name,
  };
}

export function mapSelectedStickersToPayload(input: {
  stateStickers: Record<string, string>;
  numericStickers: Record<string, string>;
  parentSticker?: ParentStickerConfig;
  includeParentSticker?: boolean;
}): Record<string, string> {
  return {
    ...input.stateStickers,
    ...input.numericStickers,
    ...(input.includeParentSticker && input.parentSticker
      ? { [input.parentSticker.stickerId]: input.parentSticker.stateId }
      : {}),
  };
}
