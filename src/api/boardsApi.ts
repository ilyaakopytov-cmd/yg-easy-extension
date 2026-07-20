export type YouGileBoard = {
  id: string;
  projectId?: string;
  title: string;
  stickers?: {
    deadline?: boolean;
    assignee?: boolean;
    repeat?: boolean;
    stopwatch?: boolean;
    timer?: boolean;
    timeTracking?: boolean;
    custom?: Record<string, boolean>;
  };
};

export type BoardsResponse = {
  content: YouGileBoard[];
};
