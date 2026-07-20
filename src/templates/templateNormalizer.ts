import type { TaskNode } from '../task-tree/taskTreeTypes';

export type TemplateProjectTraitsMode = {
  includeProjectTraits: boolean;
  projectStickerId?: string;
};

export function prepareTaskTreeTemplateRoot(
  root: TaskNode,
  options: TemplateProjectTraitsMode,
): TaskNode {
  return normalizeTemplateNode(root, null, 0, 0, options);
}

function normalizeTemplateNode(
  node: TaskNode,
  parentLocalId: string | null,
  level: number,
  order: number,
  options: TemplateProjectTraitsMode,
): TaskNode {
  const cleanedTitle = cleanTemplateTitle(node, options.includeProjectTraits);
  const stickers = options.includeProjectTraits
    ? { ...node.stickers }
    : removeProjectSticker(node.stickers, options.projectStickerId);

  const nextNode: TaskNode = {
    ...node,
    localId: parentLocalId === null ? 'root' : node.localId,
    parentLocalId,
    level,
    order,
    title: cleanedTitle,
    titleSuffix: node.titleSuffix ? removeStartDateTitlePrefix(node.titleSuffix) : undefined,
    stickers,
    numericStickers: { ...(node.numericStickers ?? {}) },
    deadline: undefined,
    startDate: undefined,
    hasStartDateFlag: undefined,
    yougileTaskId: undefined,
    status: 'draft',
    error: undefined,
  };

  const projectAwareNode = options.includeProjectTraits
    ? nextNode
    : {
        ...nextNode,
        projectId: undefined,
        projectTitle: undefined,
        boardId: undefined,
        boardTitle: undefined,
        columnId: undefined,
        columnTitle: undefined,
        includeBoardTitleInTitle: false,
      };

  return {
    ...projectAwareNode,
    children: node.children.map((child, index) =>
      normalizeTemplateNode(child, projectAwareNode.localId, level + 1, index, options),
    ),
  };
}

function cleanTemplateTitle(node: TaskNode, includeProjectTraits: boolean): string {
  const withoutDate = removeStartDateTitlePrefix(node.title);

  if (includeProjectTraits) {
    return withoutDate;
  }

  return removeKnownTitlePrefix(withoutDate, [node.boardTitle, node.projectTitle]);
}

function removeProjectSticker(stickers: Record<string, string>, projectStickerId?: string): Record<string, string> {
  if (!projectStickerId) {
    return { ...stickers };
  }

  const { [projectStickerId]: _removed, ...rest } = stickers;
  return rest;
}

function removeKnownTitlePrefix(title: string, prefixes: Array<string | undefined>): string {
  let result = title.trim();

  for (const prefix of prefixes) {
    const normalizedPrefix = prefix?.trim();

    if (!normalizedPrefix) {
      continue;
    }

    if (result === normalizedPrefix) {
      result = '';
      continue;
    }

    if (result.startsWith(`${normalizedPrefix} / `)) {
      result = result.slice(`${normalizedPrefix} / `.length).trim();
    }
  }

  return result;
}

function removeStartDateTitlePrefix(title: string): string {
  return title.replace(/^\d{2}\.\d{2}\.\s*/, '').trim();
}
