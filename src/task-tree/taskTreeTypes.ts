export type TaskNodeStatus = 'draft' | 'valid' | 'creating' | 'created' | 'error';

export type TaskTitleMode = 'custom' | 'copy_parent' | 'copy_parent_and_extend';

export type TaskNode = {
  localId: string;
  parentLocalId: string | null;
  level: number;
  order: number;
  titleMode: TaskTitleMode;
  title: string;
  titleSuffix?: string;
  description: string;
  projectTitle?: string;
  projectId?: string;
  boardId?: string;
  boardTitle?: string;
  includeBoardTitleInTitle?: boolean;
  autoProjectStickerEnabled?: boolean;
  columnId?: string;
  columnTitle?: string;
  executorUserId?: string;
  executorName?: string;
  executorDepartmentId?: string;
  executorDepartmentName?: string;
  deadline?: string;
  startDate?: string;
  isParentFlag?: boolean;
  hasStartDateFlag?: boolean;
  stickers: Record<string, string>;
  numericStickers?: Record<string, string>;
  children: TaskNode[];
  yougileTaskId?: string;
  status: TaskNodeStatus;
  error?: string;
};
