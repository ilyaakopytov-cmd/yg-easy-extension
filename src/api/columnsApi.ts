export type YouGileColumn = {
  id: string;
  boardId: string;
  title: string;
};

export type ColumnsResponse = {
  content: YouGileColumn[];
};
