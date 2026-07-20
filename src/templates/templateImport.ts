import type { DirectoriesCache } from '../storage/directoriesStorage';
import {
  TASK_TREE_TEMPLATE_FORMAT,
  TASK_TREE_TEMPLATE_VERSION,
  type TaskTreeTemplate,
} from '../storage/templatesStorage';
import type { TaskNode, TaskTitleMode } from '../task-tree/taskTreeTypes';
import {
  MULTI_TEMPLATE_EXPORT_FORMAT,
  SINGLE_TEMPLATE_EXPORT_FORMAT,
  TEMPLATE_EXPORT_VERSION,
  type ExportedDirectoryRef,
  type ExportedTaskNode,
  type ExportedTaskTreeTemplate,
  type MultiTemplateExportDocument,
  type SingleTemplateExportDocument,
} from './templateExport';
import { prepareTaskTreeTemplateRoot } from './templateNormalizer';

export type TemplateImportResult = {
  templates: TaskTreeTemplate[];
  warnings: string[];
  unresolvedCount: number;
};

export function parseTemplatesImportDocument(
  value: unknown,
  directories: DirectoriesCache,
  importedAt = new Date().toISOString(),
): TemplateImportResult {
  const warnings: string[] = [];
  const tracker = createImportTracker(warnings);
  const exportedTemplates = readExportedTemplates(value);

  if (!exportedTemplates.length) {
    throw new Error('Файл не похож на экспорт шаблонов YG Easy.');
  }

  return {
    templates: exportedTemplates.map((template, index) =>
      importTemplate(template, directories, tracker, importedAt, index),
    ),
    warnings,
    unresolvedCount: tracker.unresolvedCount,
  };
}

function readExportedTemplates(value: unknown): ExportedTaskTreeTemplate[] {
  if (!isObject(value)) {
    return [];
  }

  const document = value as Partial<SingleTemplateExportDocument | MultiTemplateExportDocument>;

  if (document.format === SINGLE_TEMPLATE_EXPORT_FORMAT && document.version === TEMPLATE_EXPORT_VERSION) {
    return isExportedTemplate(document.template) ? [document.template] : [];
  }

  if (document.format === MULTI_TEMPLATE_EXPORT_FORMAT && document.version === TEMPLATE_EXPORT_VERSION) {
    return Array.isArray(document.templates) ? document.templates.filter(isExportedTemplate) : [];
  }

  return isExportedTemplate(value) ? [value] : [];
}

function importTemplate(
  template: ExportedTaskTreeTemplate,
  directories: DirectoriesCache,
  tracker: ImportTracker,
  importedAt: string,
  index: number,
): TaskTreeTemplate {
  const projectTraitsIncluded = template.projectTraitsIncluded ?? true;
  const root = importNode(template.root, null, 0, 0, directories, tracker);

  return {
    format: TASK_TREE_TEMPLATE_FORMAT,
    version: TASK_TREE_TEMPLATE_VERSION,
    id: makeImportedTemplateId(template.id, index),
    title: template.title || 'Импортированный шаблон',
    projectTraitsIncluded,
    root: prepareTaskTreeTemplateRoot(root, {
      includeProjectTraits: projectTraitsIncluded,
      projectStickerId: findProjectStickerId(directories),
    }),
    createdAt: importedAt,
    updatedAt: importedAt,
  };
}

function importNode(
  node: ExportedTaskNode,
  parentLocalId: string | null,
  level: number,
  order: number,
  directories: DirectoriesCache,
  tracker: ImportTracker,
): TaskNode {
  const localId = makeImportedNodeId();
  const project = resolveDirectoryRef(node.project, directories.projects, 'проект', tracker);
  const board = resolveBoardRef(node.board, directories, project.id, tracker);
  const column = resolveColumnRef(node.column, directories, board.id, tracker);
  const executor = resolveDirectoryRef(
    node.executor,
    directories.users.map((user) => ({
      id: user.id,
      name: user.realName || user.email || user.id,
      aliases: [user.realName, user.email],
    })),
    'исполнитель',
    tracker,
  );
  const importedNode: TaskNode = {
    localId,
    parentLocalId,
    level,
    order,
    titleMode: normalizeTitleMode(node.titleMode),
    title: typeof node.title === 'string' ? node.title : '',
    titleSuffix: typeof node.titleSuffix === 'string' ? node.titleSuffix : undefined,
    description: typeof node.description === 'string' ? node.description : '',
    projectId: project.id,
    projectTitle: project.name,
    boardId: board.id,
    boardTitle: board.name,
    columnId: column.id,
    columnTitle: column.name,
    executorUserId: executor.id,
    executorName: executor.name,
    includeBoardTitleInTitle: node.includeBoardTitleInTitle,
    autoProjectStickerEnabled: node.autoProjectStickerEnabled,
    isParentFlag: node.isParentFlag,
    stickers: importStateStickers(node.stickers, directories, tracker),
    numericStickers: importNumericStickers(node.numericStickers, directories, tracker),
    children: [],
    status: 'draft',
  };

  importedNode.children = (Array.isArray(node.children) ? node.children : []).map((child, childIndex) =>
    importNode(child, localId, level + 1, childIndex, directories, tracker),
  );

  return importedNode;
}

function importStateStickers(
  stickers: ExportedTaskNode['stickers'],
  directories: DirectoriesCache,
  tracker: ImportTracker,
): Record<string, string> {
  const result: Record<string, string> = {};

  if (!Array.isArray(stickers)) {
    return result;
  }

  for (const exportedSticker of stickers) {
    const sticker = resolveSticker(exportedSticker.id, exportedSticker.name, directories, tracker);
    const state = sticker?.states.find((item) =>
      equalsIgnoreCase(item.id, exportedSticker.stateId) || equalsIgnoreCase(item.name, exportedSticker.state),
    );

    if (sticker?.id && state?.id) {
      result[sticker.id] = state.id;
    } else if (exportedSticker.id && exportedSticker.stateId) {
      result[exportedSticker.id] = exportedSticker.stateId;
      tracker.warn(`Стикер "${exportedSticker.name || exportedSticker.id}" импортирован по ID без подтверждения справочником.`);
    }
  }

  return result;
}

function importNumericStickers(
  stickers: ExportedTaskNode['numericStickers'],
  directories: DirectoriesCache,
  tracker: ImportTracker,
): Record<string, string> {
  const result: Record<string, string> = {};

  if (!Array.isArray(stickers)) {
    return result;
  }

  const numericStickers = directories.boardStickerConfig.flatMap((config) => config.numeric);

  for (const exportedSticker of stickers) {
    const sticker = numericStickers.find((item) =>
      equalsIgnoreCase(item.id, exportedSticker.id) || equalsIgnoreCase(item.title, exportedSticker.name),
    );
    const stickerId = sticker?.id ?? exportedSticker.id;

    if (stickerId && typeof exportedSticker.value === 'string') {
      result[stickerId] = exportedSticker.value;
      if (!sticker) {
        tracker.warn(`Числовой стикер "${exportedSticker.name || exportedSticker.id}" импортирован по ID без подтверждения справочником.`);
      }
    }
  }

  return result;
}

function resolveDirectoryRef<T extends { id: string; title?: string; name?: string; aliases?: Array<string | undefined> }>(
  ref: ExportedDirectoryRef | undefined,
  directory: T[],
  label: string,
  tracker: ImportTracker,
): { id?: string; name?: string } {
  if (!ref) {
    return {};
  }

  const item = findDirectoryItem(ref, directory);

  if (!item && (ref.id || ref.name)) {
    tracker.unresolved(`Не найден справочник "${label}": ${ref.name || ref.id}.`);
  }

  return {
    id: item?.id ?? ref.id,
    name: item?.title ?? item?.name ?? ref.name,
  };
}

function resolveBoardRef(
  ref: ExportedDirectoryRef | undefined,
  directories: DirectoriesCache,
  projectId: string | undefined,
  tracker: ImportTracker,
): { id?: string; name?: string } {
  if (!ref) {
    return {};
  }

  const projectBoards = projectId ? directories.boards.filter((board) => board.projectId === projectId) : [];
  const scopedItem = projectBoards.length ? findDirectoryItem(ref, projectBoards) : undefined;
  const globalItem = scopedItem ?? findDirectoryItem(ref, directories.boards);

  if (!globalItem) {
    tracker.unresolved(`Не найдена доска: ${ref.name || ref.id}.`);
    return { id: ref.id, name: ref.name };
  }

  if (projectId && globalItem.projectId && globalItem.projectId !== projectId) {
    tracker.warn(`Доска "${globalItem.title}" найдена, но она привязана к другому проекту.`);
  }

  return {
    id: globalItem.id,
    name: globalItem.title,
  };
}

function resolveColumnRef(
  ref: ExportedDirectoryRef | undefined,
  directories: DirectoriesCache,
  boardId: string | undefined,
  tracker: ImportTracker,
): { id?: string; name?: string } {
  if (!ref) {
    return {};
  }

  const boardColumns = boardId ? directories.columns.filter((column) => column.boardId === boardId) : [];
  const scopedItem = boardColumns.length ? findDirectoryItem(ref, boardColumns) : undefined;
  const globalItem = scopedItem ?? findDirectoryItem(ref, directories.columns);

  if (!globalItem) {
    tracker.unresolved(`Не найдена колонка: ${ref.name || ref.id}.`);
    return { id: ref.id, name: ref.name };
  }

  if (boardId && globalItem.boardId !== boardId) {
    tracker.warn(`Колонка "${globalItem.title}" найдена, но она привязана к другой доске.`);
  }

  return {
    id: globalItem.id,
    name: globalItem.title,
  };
}

function findDirectoryItem<T extends { id: string; title?: string; name?: string; aliases?: Array<string | undefined> }>(
  ref: ExportedDirectoryRef,
  directory: T[],
): T | undefined {
  return (
    directory.find((candidate) => equalsIgnoreCase(candidate.id, ref.id)) ??
    directory.find((candidate) =>
      [candidate.title, candidate.name, ...(candidate.aliases ?? [])].some((name) => equalsIgnoreCase(name, ref.name)),
    )
  );
}

function resolveSticker(
  id: string | undefined,
  name: string | undefined,
  directories: DirectoriesCache,
  tracker: ImportTracker,
) {
  const sticker = directories.stickers.find((item) => equalsIgnoreCase(item.id, id) || equalsIgnoreCase(item.name, name));

  if (!sticker && (id || name)) {
    tracker.unresolved(`Не найден стикер: ${name || id}.`);
  }

  return sticker;
}

type ImportTracker = {
  warnings: string[];
  unresolvedCount: number;
  warn(message: string): void;
  unresolved(message: string): void;
};

function createImportTracker(warnings: string[]): ImportTracker {
  return {
    warnings,
    unresolvedCount: 0,
    warn(message: string) {
      addUniqueWarning(warnings, message);
    },
    unresolved(message: string) {
      this.unresolvedCount += 1;
      addUniqueWarning(warnings, message);
    },
  };
}

function addUniqueWarning(warnings: string[], message: string): void {
  if (!warnings.includes(message)) {
    warnings.push(message);
  }
}

function normalizeTitleMode(value: unknown): TaskTitleMode {
  return value === 'copy_parent' || value === 'copy_parent_and_extend' ? value : 'custom';
}

function isExportedTemplate(value: unknown): value is ExportedTaskTreeTemplate {
  return isObject(value) && typeof value.title === 'string' && isObject(value.root);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function equalsIgnoreCase(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.trim().toLocaleLowerCase('ru-RU') === right.trim().toLocaleLowerCase('ru-RU'));
}

function makeImportedTemplateId(sourceId: string | undefined, index: number): string {
  const suffix = sourceId ? sourceId.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 24) : index.toString(36);
  return `template-import-${Date.now().toString(36)}-${suffix}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeImportedNodeId(): string {
  return `import-node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function findProjectStickerId(directories: DirectoriesCache): string | undefined {
  return directories.stickers.find((sticker) => equalsIgnoreCase(sticker.name, 'Проект'))?.id;
}
