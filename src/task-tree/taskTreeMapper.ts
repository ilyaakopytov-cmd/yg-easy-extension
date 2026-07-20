import type { CreateTaskPayload } from '../api/tasksApi';
import type { TaskNode } from './taskTreeTypes';
import { buildTaskTitle } from './taskTreeValidator';

export function mapTaskNodeToPayload(
  node: TaskNode,
  subtasks: string[],
  isRoot: boolean,
  title: string = buildTaskTitle(node),
): CreateTaskPayload {
  const stickers = {
    ...node.stickers,
    ...(node.numericStickers ?? {}),
  };
  const payloadTitle = ensureBoardTitlePrefix(node, title);

  return {
    title: payloadTitle,
    description: node.description || undefined,
    columnId: isRoot ? node.columnId : undefined,
    assigned: node.executorUserId ? [node.executorUserId] : undefined,
    deadline: mapDeadline(node),
    stickers: Object.keys(stickers).length ? stickers : undefined,
    subtasks: subtasks.length ? subtasks : undefined,
  };
}

function ensureBoardTitlePrefix(node: TaskNode, title: string): string {
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

function mapDeadline(node: TaskNode): CreateTaskPayload['deadline'] {
  const deadline = dateInputToTimestamp(node.deadline);

  if (!deadline) {
    return undefined;
  }

  return {
    deadline,
    startDate: 0,
    withTime: false,
  };
}

function dateInputToTimestamp(value?: string): number | undefined {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return undefined;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const timestamp = new Date(year, monthIndex, day, 12).getTime();

  return Number.isNaN(timestamp) ? undefined : timestamp;
}
