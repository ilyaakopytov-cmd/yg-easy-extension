import type { TaskNode } from './taskTreeTypes';

export type TaskTreeValidationIssueCode =
  | 'missing_root'
  | 'missing_title'
  | 'missing_project'
  | 'missing_board'
  | 'missing_root_column'
  | 'missing_column_id'
  | 'missing_executor'
  | 'missing_sticker_id'
  | 'missing_state_id'
  | 'duplicate_local_id'
  | 'broken_parent_reference'
  | 'level_mismatch'
  | 'missing_description'
  | 'missing_deadline'
  | 'missing_optional_executor'
  | 'stale_directories'
  | 'deep_tree'
  | 'duplicate_title';

export type TaskTreeValidationIssue = {
  code: TaskTreeValidationIssueCode;
  message: string;
  localId?: string;
};

export type TaskTreeValidationResult = {
  errors: TaskTreeValidationIssue[];
  warnings: TaskTreeValidationIssue[];
  isValid: boolean;
};

export type TaskTreeValidationContext = {
  requireExecutor?: boolean;
  directoriesAreStale?: boolean;
  knownProjectIds?: Set<string>;
  knownBoardIds?: Set<string>;
  knownColumnIds?: Set<string>;
  knownUserIds?: Set<string>;
  knownStickerIds?: Set<string>;
  knownStateIds?: Set<string>;
};

export function validateTaskTree(
  root: TaskNode | null,
  context: TaskTreeValidationContext = {},
): TaskTreeValidationResult {
  if (!root) {
    return {
      errors: [{ code: 'missing_root', message: 'У дерева нет верхней root-задачи.' }],
      warnings: [],
      isValid: false,
    };
  }

  const errors: TaskTreeValidationIssue[] = [];
  const warnings: TaskTreeValidationIssue[] = [];
  const nodes = flattenTaskTree(root);
  const titleByLocalId = buildTitleMap(root);
  const ids = new Set<string>();
  const titleCounts = new Map<string, number>();

  for (const node of nodes) {
    if (ids.has(node.localId)) {
      errors.push({
        code: 'duplicate_local_id',
        localId: node.localId,
        message: `Дублируется localId задачи: ${node.localId}.`,
      });
    }
    ids.add(node.localId);

    const title = (titleByLocalId.get(node.localId) ?? buildTaskTitle(node)).trim();
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);

    validateNodeRequiredFields(node, title, context, errors);
    validateNodeReferences(node, context, errors);
    collectNodeWarnings(node, title, context, warnings);
  }

  for (const node of nodes) {
    if (node.parentLocalId && !ids.has(node.parentLocalId)) {
      errors.push({
        code: 'broken_parent_reference',
        localId: node.localId,
        message: `Задача "${titleByLocalId.get(node.localId) ?? buildTaskTitle(node)}" ссылается на несуществующего родителя.`,
      });
    }

    for (const child of node.children) {
      if (child.parentLocalId !== node.localId) {
        errors.push({
          code: 'broken_parent_reference',
          localId: child.localId,
          message: `У задачи "${titleByLocalId.get(child.localId) ?? buildTaskTitle(child)}" неверная ссылка на родителя.`,
        });
      }

      if (child.level !== node.level + 1) {
        errors.push({
          code: 'level_mismatch',
          localId: child.localId,
          message: `У задачи "${titleByLocalId.get(child.localId) ?? buildTaskTitle(child)}" некорректный уровень вложенности.`,
        });
      }
    }
  }

  if (context.directoriesAreStale) {
    warnings.push({
      code: 'stale_directories',
      message: 'Справочники устарели. Рекомендуется обновить перед созданием задач.',
    });
  }

  if (Math.max(...nodes.map((node) => node.level)) > 7) {
    warnings.push({
      code: 'deep_tree',
      message: 'Глубина дерева больше 7 уровней.',
    });
  }

  for (const [title, count] of titleCounts.entries()) {
    if (title && count > 1) {
      warnings.push({
        code: 'duplicate_title',
        message: `Несколько задач имеют одинаковое название: "${title}".`,
      });
    }
  }

  return { errors, warnings, isValid: errors.length === 0 };
}

export function flattenTaskTree(root: TaskNode): TaskNode[] {
  return [root, ...root.children.flatMap((child) => flattenTaskTree(child))];
}

export function buildTaskTitle(node: TaskNode, parentTitle = ''): string {
  let title: string;

  if (node.titleMode === 'copy_parent') {
    title = removeStartDateTitlePrefix(parentTitle) || node.title;
  } else if (node.titleMode === 'copy_parent_and_extend') {
    const baseTitle = removeStartDateTitlePrefix(parentTitle) || node.title;
    title = node.titleSuffix ? `${baseTitle} / ${node.titleSuffix}` : baseTitle;
  } else {
    title = node.title;
  }

  return withStartDateTitle(node, withBoardTitle(node, title));
}

function withBoardTitle(node: TaskNode, title: string): string {
  const boardTitle = node.boardTitle?.trim();

  if (!node.includeBoardTitleInTitle || !boardTitle) {
    return title;
  }

  const normalizedTitle = title.trim();

  if (!normalizedTitle) {
    return boardTitle;
  }

  if (normalizedTitle === boardTitle || normalizedTitle.startsWith(`${boardTitle} / `)) {
    return normalizedTitle;
  }

  return `${boardTitle} / ${normalizedTitle}`;
}

function withStartDateTitle(node: TaskNode, title: string): string {
  const startDateTitle = formatDateTitlePrefix(node.startDate);

  if (!startDateTitle) {
    return title;
  }

  const normalizedTitle = title.trim();

  if (!normalizedTitle) {
    return startDateTitle;
  }

  if (normalizedTitle.startsWith(`${startDateTitle} `)) {
    return normalizedTitle;
  }

  return `${startDateTitle} ${normalizedTitle}`;
}

function formatDateTitlePrefix(value?: string): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return '';
  }

  return `${match[3]}.${match[2]}.`;
}

function removeStartDateTitlePrefix(title: string): string {
  return title.replace(/^\d{2}\.\d{2}\.\s+/, '');
}

export function buildTitleMap(root: TaskNode): Map<string, string> {
  const titles = new Map<string, string>();

  function visit(node: TaskNode, parentTitle: string) {
    const title = buildTaskTitle(node, parentTitle);
    titles.set(node.localId, title);

    for (const child of node.children) {
      visit(child, title);
    }
  }

  visit(root, '');
  return titles;
}

function validateNodeRequiredFields(
  node: TaskNode,
  title: string,
  context: TaskTreeValidationContext,
  errors: TaskTreeValidationIssue[],
) {
  if (!title) {
    errors.push({
      code: 'missing_title',
      localId: node.localId,
      message: 'Не заполнено название задачи.',
    });
  }

  if (!node.projectId) {
    errors.push({
      code: 'missing_project',
      localId: node.localId,
      message: `Для задачи "${title || node.localId}" не выбран проект.`,
    });
  }

  if (!node.boardId) {
    errors.push({
      code: 'missing_board',
      localId: node.localId,
      message: `Для задачи "${title || node.localId}" не выбрана доска.`,
    });
  }

  if (node.parentLocalId === null && !node.columnId) {
    errors.push({
      code: 'missing_root_column',
      localId: node.localId,
      message: 'Не выбрана колонка для верхнего родителя.',
    });
  }

  if (context.requireExecutor && !node.executorUserId) {
    errors.push({
      code: 'missing_executor',
      localId: node.localId,
      message: `Для задачи "${title || node.localId}" не найден исполнитель.`,
    });
  }
}

function validateNodeReferences(
  node: TaskNode,
  context: TaskTreeValidationContext,
  errors: TaskTreeValidationIssue[],
) {
  if (node.projectId && context.knownProjectIds && !context.knownProjectIds.has(node.projectId)) {
    errors.push({ code: 'missing_project', localId: node.localId, message: 'Проект не найден в справочниках.' });
  }

  if (node.boardId && context.knownBoardIds && !context.knownBoardIds.has(node.boardId)) {
    errors.push({ code: 'missing_board', localId: node.localId, message: 'Доска не найдена в справочниках.' });
  }

  if (node.columnId && context.knownColumnIds && !context.knownColumnIds.has(node.columnId)) {
    errors.push({ code: 'missing_column_id', localId: node.localId, message: 'Колонка не найдена в справочниках.' });
  }

  if (node.executorUserId && context.knownUserIds && !context.knownUserIds.has(node.executorUserId)) {
    errors.push({ code: 'missing_executor', localId: node.localId, message: 'Исполнитель не найден в справочниках.' });
  }

  for (const [stickerId, stateId] of Object.entries(node.stickers)) {
    if (!stickerId || (context.knownStickerIds && !context.knownStickerIds.has(stickerId))) {
      errors.push({ code: 'missing_sticker_id', localId: node.localId, message: 'Не найден stickerId.' });
    }

    if (!stateId || (context.knownStateIds && !context.knownStateIds.has(stateId))) {
      errors.push({ code: 'missing_state_id', localId: node.localId, message: 'Не найден stateId.' });
    }
  }

  for (const stickerId of Object.keys(node.numericStickers ?? {})) {
    if (!stickerId || (context.knownStickerIds && !context.knownStickerIds.has(stickerId))) {
      errors.push({ code: 'missing_sticker_id', localId: node.localId, message: 'Не найден stickerId числового поля.' });
    }
  }
}

function collectNodeWarnings(
  node: TaskNode,
  title: string,
  _context: TaskTreeValidationContext,
  warnings: TaskTreeValidationIssue[],
) {
  if (!node.description.trim()) {
    warnings.push({
      code: 'missing_description',
      localId: node.localId,
      message: `У задачи "${title || node.localId}" не заполнено описание.`,
    });
  }

  if (!node.deadline) {
    warnings.push({
      code: 'missing_deadline',
      localId: node.localId,
      message: `У задачи "${title || node.localId}" не указан дедлайн.`,
    });
  }

  if (!node.executorUserId) {
    warnings.push({
      code: 'missing_optional_executor',
      localId: node.localId,
      message: `У задачи "${title || node.localId}" не выбран исполнитель.`,
    });
  }
}
