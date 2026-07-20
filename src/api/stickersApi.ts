export type YouGileStickerState = {
  id: string;
  name: string;
  color?: string;
};

export type YouGileStringSticker = {
  id: string;
  name: string;
  states: YouGileStickerState[];
};

export type StringStickersResponse = {
  content: YouGileStringSticker[];
};
