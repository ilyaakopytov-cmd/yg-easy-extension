import type { DirectoriesCache } from '../storage/directoriesStorage';
import type { TaskTreeTemplate } from '../storage/templatesStorage';
import type { TaskNode, TaskTitleMode } from '../task-tree/taskTreeTypes';

export const SINGLE_TEMPLATE_EXPORT_FORMAT = 'yg-easy-task-template';
export const MULTI_TEMPLATE_EXPORT_FORMAT = 'yg-easy-task-templates';
export const TEMPLATE_EXPORT_VERSION = 1;

export type ExportedTaskTreeTemplate = {
  id: string;
  title: string;
  projectTraitsIncluded: boolean;
  createdAt: string;
  updatedAt: string;
  root: ExportedTaskNode;
};

export type ExportedTaskNode = {
  titleMode: TaskTitleMode;
  title: string;
  titleSuffix?: string;
  description: string;
  project?: ExportedDirectoryRef;
  board?: ExportedDirectoryRef;
  column?: ExportedDirectoryRef;
  executor?: ExportedDirectoryRef;
  includeBoardTitleInTitle?: boolean;
  autoProjectStickerEnabled?: boolean;
  isParentFlag?: boolean;
  stickers: ExportedStateSticker[];
  numericStickers: ExportedNumericSticker[];
  children: ExportedTaskNode[];
};

export type ExportedDirectoryRef = {
  id?: string;
  name?: string;
};

export type ExportedStateSticker = {
  id: string;
  name: string;
  stateId: string;
  state: string;
};

export type ExportedNumericSticker = {
  id: string;
  name: string;
  value: string;
};

export type SingleTemplateExportDocument = {
  format: typeof SINGLE_TEMPLATE_EXPORT_FORMAT;
  version: typeof TEMPLATE_EXPORT_VERSION;
  exportedAt: string;
  template: ExportedTaskTreeTemplate;
};

export type MultiTemplateExportDocument = {
  format: typeof MULTI_TEMPLATE_EXPORT_FORMAT;
  version: typeof TEMPLATE_EXPORT_VERSION;
  exportedAt: string;
  templates: ExportedTaskTreeTemplate[];
};

export function buildSingleTemplateExport(
  template: TaskTreeTemplate,
  directories: DirectoriesCache,
  exportedAt = new Date().toISOString(),
): SingleTemplateExportDocument {
  return {
    format: SINGLE_TEMPLATE_EXPORT_FORMAT,
    version: TEMPLATE_EXPORT_VERSION,
    exportedAt,
    template: exportTemplate(template, directories),
  };
}

export function buildTemplatesExport(
  templates: TaskTreeTemplate[],
  directories: DirectoriesCache,
  exportedAt = new Date().toISOString(),
): MultiTemplateExportDocument {
  return {
    format: MULTI_TEMPLATE_EXPORT_FORMAT,
    version: TEMPLATE_EXPORT_VERSION,
    exportedAt,
    templates: templates.map((template) => exportTemplate(template, directories)),
  };
}

function exportTemplate(template: TaskTreeTemplate, directories: DirectoriesCache): ExportedTaskTreeTemplate {
  return {
    id: template.id,
    title: template.title,
    projectTraitsIncluded: template.projectTraitsIncluded,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    root: exportNode(template.root, directories),
  };
}

function exportNode(node: TaskNode, directories: DirectoriesCache): ExportedTaskNode {
  return removeEmptyRefs({
    titleMode: node.titleMode,
    title: node.title,
    titleSuffix: node.titleSuffix,
    description: node.description,
    project: makeRef(node.projectId, node.projectTitle, directories.projects),
    board: makeRef(node.boardId, node.boardTitle, directories.boards),
    column: makeRef(node.columnId, node.columnTitle, directories.columns),
    executor: makeRef(node.executorUserId, node.executorName, directories.users),
    includeBoardTitleInTitle: node.includeBoardTitleInTitle,
    autoProjectStickerEnabled: node.autoProjectStickerEnabled,
    isParentFlag: node.isParentFlag,
    stickers: exportStateStickers(node.stickers, directories),
    numericStickers: exportNumericStickers(node.numericStickers ?? {}, directories),
    children: node.children.map((child) => exportNode(child, directories)),
  });
}

function exportStateStickers(
  stickers: Record<string, string>,
  directories: DirectoriesCache,
): ExportedStateSticker[] {
  return Object.entries(stickers).map(([stickerId, stateId]) => {
    const sticker = directories.stickers.find((item) => item.id === stickerId);
    const state = sticker?.states.find((item) => item.id === stateId);

    return {
      id: stickerId,
      name: sticker?.name ?? stickerId,
      stateId,
      state: state?.name ?? stateId,
    };
  });
}

function exportNumericStickers(
  numericStickers: Record<string, string>,
  directories: DirectoriesCache,
): ExportedNumericSticker[] {
  const numericNames = new Map(
    directories.boardStickerConfig.flatMap((config) => config.numeric.map((sticker) => [sticker.id, sticker.title])),
  );

  return Object.entries(numericStickers).map(([stickerId, value]) => ({
    id: stickerId,
    name: numericNames.get(stickerId) ?? stickerId,
    value,
  }));
}

function makeRef<T extends { id: string; title?: string; name?: string; realName?: string; email?: string }>(
  id: string | undefined,
  name: string | undefined,
  directory: T[],
): ExportedDirectoryRef | undefined {
  if (!id && !name) {
    return undefined;
  }

  const item = id ? directory.find((candidate) => candidate.id === id) : undefined;

  return {
    id,
    name: name || item?.title || item?.name || item?.realName || item?.email || id,
  };
}

function removeEmptyRefs(node: ExportedTaskNode): ExportedTaskNode {
  return Object.fromEntries(
    Object.entries(node).filter(([, value]) => value !== undefined && value !== false),
  ) as ExportedTaskNode;
}
