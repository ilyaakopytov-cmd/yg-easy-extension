import { describe, expect, it } from 'vitest';
import { getAddableStickerOptions, getParentStickerConfig, mapSelectedStickersToPayload } from './stickerCatalog';

const stickers = [
  {
    id: 'priority',
    name: 'Приоритет',
    states: [{ id: 'high', name: 'Важно', color: '#ff0000' }],
  },
  {
    id: 'parent',
    name: 'Родитель',
    states: [{ id: 'yes', name: 'Да', color: '#cccccc' }],
  },
  {
    id: 'stage',
    name: 'Этап',
    states: [{ id: 'dev', name: 'Разработка', color: '#0000ff' }],
  },
];

describe('stickerCatalog', () => {
  it('returns board stickers except parent and recurring task controls', () => {
    const options = getAddableStickerOptions('board-1', stickers, [
      {
        boardId: 'board-1',
        system: ['deadline', 'assignee'],
        custom: ['priority', 'parent', 'stage'],
        numeric: [
          { id: 'hours', title: 'Факт часов' },
          { id: 'repeat', title: 'Регулярная задача' },
        ],
      },
    ]);

    expect(options.map((option) => option.name)).toEqual(['Приоритет', 'Факт часов', 'Этап']);
  });

  it('finds parent sticker config from string stickers', () => {
    expect(getParentStickerConfig(stickers)).toEqual({
      stickerId: 'parent',
      stateId: 'yes',
      name: 'Родитель',
    });
  });

  it('maps state, numeric and parent stickers to YouGile payload', () => {
    expect(
      mapSelectedStickersToPayload({
        stateStickers: { priority: 'high' },
        numericStickers: { hours: '1.5' },
        parentSticker: { stickerId: 'parent', stateId: 'yes', name: 'Родитель' },
        includeParentSticker: true,
      }),
    ).toEqual({
      priority: 'high',
      hours: '1.5',
      parent: 'yes',
    });
  });
});
