import type { YouGileStringSticker } from '../api/stickersApi';

export type AddableStickerOption =
  | {
      kind: 'state';
      id: string;
      name: string;
      states: YouGileStringSticker['states'];
    }
  | {
      kind: 'numeric';
      id: string;
      name: string;
    };

export type ParentStickerConfig = {
  stickerId: string;
  stateId: string;
  name: string;
} | null;
