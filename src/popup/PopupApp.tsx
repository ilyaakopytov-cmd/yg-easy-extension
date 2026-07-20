import { useEffect, useMemo, useRef, useState } from 'react';
import type { CreateTaskPayload, CreatedTask } from '../api/tasksApi';
import { getUserDisplayName } from '../api/usersApi';
import { sendBackgroundMessage, type CreateYouGileTaskTreeResult } from '../background/messages';
import { AppShell } from '../shared/AppShell';
import { getAddableStickerOptions, getParentStickerConfig } from '../stickers/stickerCatalog';
import type { AddableStickerOption } from '../stickers/stickerTypes';
import {
  EMPTY_DIRECTORIES_CACHE,
  areDirectoriesStale,
  filterBoardsByProject,
  filterColumnsByBoard,
  readDirectoriesCache,
  type DirectoriesCache,
} from '../storage/directoriesStorage';
import {
  clearPopupFormDraft,
  readPopupFormDraft,
  writePopupDraft,
  writePopupFormDraft,
} from '../storage/popupDraftStorage';
import { readTemplates, type TaskTreeTemplate } from '../storage/templatesStorage';
import {
  createTaskTree,
  summarizeTaskTreeCreation,
  type TaskTreeCreationSummary,
} from '../task-tree/taskTreeCreator';
import type { TaskNode, TaskTitleMode } from '../task-tree/taskTreeTypes';
import {
  buildTitleMap,
  flattenTaskTree,
  validateTaskTree,
  type TaskTreeValidationContext,
  type TaskTreeValidationIssue,
} from '../task-tree/taskTreeValidator';
import './popup.css';

type TaskFormState = {
  title: string;
  titleSuffix: string;
  description: string;
  executorUserId: string;
  deadline: string;
  startDate: string;
  isParentFlag: boolean;
  includeBoardTitleInTitle: boolean;
  autoProjectStickerEnabled?: boolean;
  titleMode: TaskTitleMode;
  stateStickers: Record<string, string>;
  numericStickers: Record<string, string>;
};

type StickerDraft = {
  stickerId: string;
  stateId: string;
  numericValue: string;
};

type SearchableSelectOption = {
  value: string;
  label: string;
};

type StateStickerOption = Extract<AddableStickerOption, { kind: 'state' }>;

type ProjectStickerMatch = {
  stickerId: string;
  stateId: string;
};

type MockCreatedTask = CreatedTask & {
  payload: CreateTaskPayload;
};

const initialParentForm: TaskFormState = {
  title: '',
  titleSuffix: '',
  description: '',
  executorUserId: '',
  deadline: '',
  startDate: '',
  isParentFlag: true,
  includeBoardTitleInTitle: true,
  autoProjectStickerEnabled: true,
  titleMode: 'custom',
  stateStickers: {},
  numericStickers: {},
};

const initialChildForm: TaskFormState = {
  title: '',
  titleSuffix: '',
  description: '',
  executorUserId: '',
  deadline: '',
  startDate: '',
  isParentFlag: false,
  includeBoardTitleInTitle: false,
  autoProjectStickerEnabled: true,
  titleMode: 'copy_parent_and_extend',
  stateStickers: {},
  numericStickers: {},
};

const emptyStickerDraft: StickerDraft = {
  stickerId: '',
  stateId: '',
  numericValue: '',
};

export function PopupApp() {
  const [directories, setDirectories] = useState<DirectoriesCache>(EMPTY_DIRECTORIES_CACHE);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const [selectedColumnId, setSelectedColumnId] = useState('');
  const [includeChild, setIncludeChild] = useState(true);
  const [parentForm, setParentForm] = useState<TaskFormState>(initialParentForm);
  const [childForm, setChildForm] = useState<TaskFormState>(initialChildForm);
  const [parentStickerDraft, setParentStickerDraft] = useState<StickerDraft>(emptyStickerDraft);
  const [childStickerDraft, setChildStickerDraft] = useState<StickerDraft>(emptyStickerDraft);
  const [statusMessage, setStatusMessage] = useState('Загрузите справочники в широком интерфейсе или настройках.');
  const [createdPayloads, setCreatedPayloads] = useState<Array<{ localId: string; payload: CreateTaskPayload }>>([]);
  const [creationSummary, setCreationSummary] = useState<TaskTreeCreationSummary | null>(null);
  const [retryRoot, setRetryRoot] = useState<TaskNode | null>(null);
  const [isDraftRestored, setIsDraftRestored] = useState(false);
  const [templates, setTemplates] = useState<TaskTreeTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const popupTemplates = useMemo(() => templates.filter(isPopupCompatibleTemplate), [templates]);

  const boards = useMemo(
    () => filterBoardsByProject(directories.boards, selectedProjectId),
    [directories.boards, selectedProjectId],
  );
  const columns = useMemo(
    () => filterColumnsByBoard(directories.columns, selectedBoardId),
    [directories.columns, selectedBoardId],
  );
  const addableStickers = useMemo(
    () => getAddableStickerOptions(selectedBoardId, directories.stickers, directories.boardStickerConfig),
    [directories.boardStickerConfig, directories.stickers, selectedBoardId],
  );
  const parentSticker = useMemo(() => getParentStickerConfig(directories.stickers), [directories.stickers]);
  const projectStickerOption = useMemo(() => getProjectStickerOption(addableStickers), [addableStickers]);
  const projectStickerMatch = useMemo(
    () => findProjectStickerMatch(addableStickers, boards.find((board) => board.id === selectedBoardId)?.title),
    [addableStickers, boards, selectedBoardId],
  );
  const autoProjectStickerEnabled = parentForm.autoProjectStickerEnabled ?? true;

  const root = useMemo(
    () =>
      buildTwoLevelTree({
        parentForm,
        childForm,
        includeChild,
        directories,
        selectedProjectId,
        selectedBoardId,
        selectedColumnId,
        parentSticker: parentForm.isParentFlag ? parentSticker : null,
        projectSticker: autoProjectStickerEnabled ? projectStickerMatch : undefined,
        projectStickerId: projectStickerOption?.id,
      }),
    [
      autoProjectStickerEnabled,
      childForm,
      directories,
      includeChild,
      parentForm,
      parentSticker,
      projectStickerMatch,
      projectStickerOption?.id,
      selectedBoardId,
      selectedColumnId,
      selectedProjectId,
    ],
  );
  const validationContext = useMemo(() => buildValidationContext(directories), [directories]);
  const validation = useMemo(
    () => validateTaskTree(root, validationContext),
    [root, validationContext],
  );
  const titleMap = useMemo(() => buildTitleMap(root), [root]);

  useEffect(() => {
    let isMounted = true;

    async function restoreDirectories() {
      try {
        const [cachedDirectories, formDraft, storedTemplates] = await Promise.all([
          readDirectoriesCache(),
          readPopupFormDraft<TaskFormState, StickerDraft>(),
          readTemplates(),
        ]);

        if (!isMounted) {
          return;
        }

        setDirectories(cachedDirectories);
        setTemplates(storedTemplates);

        const firstProject = cachedDirectories.projects[0];
        const firstBoard = firstProject
          ? filterBoardsByProject(cachedDirectories.boards, firstProject.id)[0]
          : undefined;
        const firstColumn = firstBoard
          ? filterColumnsByBoard(cachedDirectories.columns, firstBoard.id)[0]
          : undefined;
        const fallbackSelection = {
          projectId: firstProject?.id ?? '',
          boardId: firstBoard?.id ?? '',
          columnId: firstColumn?.id ?? '',
        };
        const restoredSelection = normalizePopupSelection(formDraft, cachedDirectories, fallbackSelection);

        setSelectedProjectId(restoredSelection.projectId);
        setSelectedBoardId(restoredSelection.boardId);
        setSelectedColumnId(restoredSelection.columnId);
        setIncludeChild(formDraft?.includeChild ?? true);
        setParentForm(normalizeTaskFormState(formDraft?.parentForm, initialParentForm));
        setChildForm(normalizeTaskFormState(formDraft?.childForm, initialChildForm));
        setParentStickerDraft(normalizeStickerDraft(formDraft?.parentStickerDraft));
        setChildStickerDraft(normalizeStickerDraft(formDraft?.childStickerDraft));
        setStatusMessage(
          formDraft
            ? 'Черновик восстановлен.'
            : cachedDirectories.lastSyncAt
            ? 'Справочники загружены, можно собрать двухуровневую матрешку.'
            : 'Справочники не найдены. Откройте широкую страницу и обновите YouGile.',
        );
      } catch (error) {
        setStatusMessage(`Не удалось прочитать справочники: ${getErrorMessage(error)}`);
      } finally {
        if (isMounted) {
          setIsDraftRestored(true);
        }
      }
    }

    void restoreDirectories();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isDraftRestored) {
      return;
    }

    void writePopupFormDraft<TaskFormState, StickerDraft>({
      selectedProjectId,
      selectedBoardId,
      selectedColumnId,
      includeChild,
      parentForm,
      childForm,
      parentStickerDraft,
      childStickerDraft,
    });
  }, [
    childForm,
    childStickerDraft,
    includeChild,
    isDraftRestored,
    parentForm,
    parentStickerDraft,
    selectedBoardId,
    selectedColumnId,
    selectedProjectId,
  ]);

  const handleProjectChange = (projectId: string) => {
    const nextBoard = filterBoardsByProject(directories.boards, projectId)[0];
    const nextColumn = nextBoard ? filterColumnsByBoard(directories.columns, nextBoard.id)[0] : undefined;

    setSelectedProjectId(projectId);
    setSelectedBoardId(nextBoard?.id ?? '');
    setSelectedColumnId(nextColumn?.id ?? '');
    setParentForm((current) => ({
      ...removeProjectStickerFromForm(current, projectStickerOption?.id),
      autoProjectStickerEnabled: true,
      title: current.includeBoardTitleInTitle ? removeBoardTitlePrefix(current.title, nextBoard?.title) : current.title,
    }));
    setChildForm((current) => ({
      ...removeProjectStickerFromForm(current, projectStickerOption?.id),
      autoProjectStickerEnabled: true,
      title: current.includeBoardTitleInTitle ? removeBoardTitlePrefix(current.title, nextBoard?.title) : current.title,
    }));
    resetStickerSelection(setParentForm, setChildForm, setParentStickerDraft, setChildStickerDraft);
  };

  const handleBoardChange = (boardId: string) => {
    const board = directories.boards.find((item) => item.id === boardId);
    const nextColumn = filterColumnsByBoard(directories.columns, boardId)[0];

    setSelectedBoardId(boardId);
    setSelectedColumnId(nextColumn?.id ?? '');
    setParentForm((current) => ({
      ...removeProjectStickerFromForm(current, projectStickerOption?.id),
      autoProjectStickerEnabled: true,
      title: current.includeBoardTitleInTitle ? removeBoardTitlePrefix(current.title, board?.title) : current.title,
    }));
    setChildForm((current) => ({
      ...removeProjectStickerFromForm(current, projectStickerOption?.id),
      autoProjectStickerEnabled: true,
      title: current.includeBoardTitleInTitle ? removeBoardTitlePrefix(current.title, board?.title) : current.title,
    }));
    resetStickerSelection(setParentForm, setChildForm, setParentStickerDraft, setChildStickerDraft);
  };

  const handleAddSticker = (target: 'parent' | 'child') => {
    const draft = target === 'parent' ? parentStickerDraft : childStickerDraft;
    const option = addableStickers.find((sticker) => sticker.id === draft.stickerId);

    if (!option) {
      return;
    }

    const updater = target === 'parent' ? setParentForm : setChildForm;
    updater((current) => addStickerToForm(current, option, draft));

    if (target === 'parent') {
      setParentStickerDraft(emptyStickerDraft);
    } else {
      setChildStickerDraft(emptyStickerDraft);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await createTasksFromRoot(root);
  };

  const handleRetryFailed = async () => {
    await createTasksFromRoot(retryRoot ?? root);
  };

  const createTasksFromRoot = async (sourceRoot: TaskNode) => {
    setCreatedPayloads([]);
    setCreationSummary(null);

    if (!validation.isValid) {
      setStatusMessage('Есть критичные ошибки. Исправьте поля перед созданием.');
      return;
    }

    if (isExtensionRuntimeAvailable()) {
      const response = await sendBackgroundMessage<CreateYouGileTaskTreeResult>({
        type: 'YG_EASY_CREATE_TASK_TREE',
        root: sourceRoot,
      });

      if (!response.ok) {
        setStatusMessage(`Ошибка создания через YouGile: ${response.error}`);
        return;
      }

      setRetryRoot(response.data.root);
      setCreationSummary(response.data.summary);
      setStatusMessage(
        response.data.error
          ? `Создание остановлено: ${response.data.error}`
          : `Создание через YouGile готово: создано ${response.data.createdTasks.length}, root ${response.data.rootTaskId}.`,
      );
      return;
    }

    const draftRoot = cloneNode(sourceRoot);
    const payloads: Array<{ localId: string; payload: CreateTaskPayload }> = [];
    const creationOrder = flattenTaskTree(draftRoot)
      .slice()
      .sort((a, b) => b.level - a.level || a.order - b.order)
      .map((node) => node.localId);
    let counter = 1;

    try {
      const result = await createTaskTree(draftRoot, async (payload) => {
        const created: MockCreatedTask = {
          id: `mock-task-${counter++}`,
          title: payload.title,
          payload,
        };
        payloads.push({ localId: creationOrder[payloads.length] ?? 'root', payload: created.payload });
        return created;
      }, validationContext);

      setRetryRoot(draftRoot);
      setCreatedPayloads(payloads);
      setCreationSummary(summarizeTaskTreeCreation(draftRoot));
      setStatusMessage(`Mock-создание готово: создано ${result.createdTasks.length}, root ${result.rootTaskId}.`);
    } catch (error) {
      setRetryRoot(draftRoot);
      setCreatedPayloads(payloads);
      setCreationSummary(summarizeTaskTreeCreation(draftRoot));
      setStatusMessage(`Mock-создание остановлено: ${getErrorMessage(error)}`);
    }
  };

  const handleOpenFullPage = async () => {
    await writePopupDraft(root);

    const url =
      typeof chrome !== 'undefined' && chrome.runtime?.getURL
        ? chrome.runtime.getURL('src/fullpage/fullpage.html?source=popup')
        : '/src/fullpage/fullpage.html?source=popup';

    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      await chrome.tabs.create({ url });
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleNewMatryoshka = async () => {
    const defaults = getDefaultSelection(directories);

    setSelectedProjectId(defaults.projectId);
    setSelectedBoardId(defaults.boardId);
    setSelectedColumnId(defaults.columnId);
    setIncludeChild(true);
    setParentForm(initialParentForm);
    setChildForm(initialChildForm);
    setParentStickerDraft(emptyStickerDraft);
    setChildStickerDraft(emptyStickerDraft);
    setCreatedPayloads([]);
    setCreationSummary(null);
    setRetryRoot(null);
    setSelectedTemplateId('');
    setStatusMessage('Новая матрешка готова к заполнению.');
    await clearPopupFormDraft();
  };

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);

    const template = popupTemplates.find((item) => item.id === templateId);
    if (!template) {
      return;
    }

    const child = template.root.children[0];

    setParentForm(taskNodeToPopupForm(template.root, initialParentForm));
    setChildForm(child ? taskNodeToPopupForm(child, initialChildForm) : initialChildForm);
    setIncludeChild(Boolean(child));
    setParentStickerDraft(emptyStickerDraft);
    setChildStickerDraft(emptyStickerDraft);
    setCreatedPayloads([]);
    setCreationSummary(null);
    setRetryRoot(null);
    setStatusMessage(
      `Шаблон загружен: ${template.title}.`,
    );
  };

  const selectedParentSticker = addableStickers.find((sticker) => sticker.id === parentStickerDraft.stickerId);
  const selectedChildSticker = addableStickers.find((sticker) => sticker.id === childStickerDraft.stickerId);
  const visibleAddableStickers = addableStickers.filter((sticker) => !isProjectStickerOption(sticker));
  const selectedBoardTitle = boards.find((board) => board.id === selectedBoardId)?.title;
  const projectStickerError =
    autoProjectStickerEnabled && selectedBoardTitle && !projectStickerMatch
      ? 'Название доски не прошло сопоставления со стикером Проект'
      : '';

  return (
    <AppShell
      title="Быстрая матрешка"
      subtitle="Короткий интерфейс для двух уровней: родительская задача и подзадача."
      headerAction={
        <div className="popup-header-actions">
          <button type="button" className="popup-secondary-action" onClick={handleNewMatryoshka}>
            Новая матрёшка
          </button>
          <button type="submit" form="popup-task-form" className="popup-primary-action">
            + Добавить задачу
          </button>
          <button
            type="button"
            className="popup-open-page-button"
            title="Открыть на отдельной странице"
            aria-label="Открыть на отдельной странице"
            onClick={handleOpenFullPage}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14 5h5v5" />
              <path d="M13 11l6-6" />
              <path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" />
            </svg>
          </button>
        </div>
      }
    >
      <form id="popup-task-form" className="popup-form surface" onSubmit={handleSubmit}>
        <fieldset>
          <legend>Куда создать</legend>
          <div className="popup-grid three">
            <div className="popup-field">
              Проект
              <SearchableSelect
                value={selectedProjectId}
                placeholder="Выберите проект"
                searchPlaceholder="Поиск проекта"
                options={directories.projects.map((project) => ({ value: project.id, label: project.title }))}
                onChange={handleProjectChange}
              />
            </div>
            <div className="popup-field">
              Доска
              <SearchableSelect
                value={selectedBoardId}
                placeholder="Выберите доску"
                searchPlaceholder="Поиск доски"
                disabled={!selectedProjectId}
                options={boards.map((board) => ({ value: board.id, label: board.title }))}
                onChange={handleBoardChange}
              />
            </div>
            <div className="popup-field">
              Колонка
              <SearchableSelect
                value={selectedColumnId}
                placeholder="Выберите колонку"
                searchPlaceholder="Поиск колонки"
                disabled={!selectedBoardId}
                options={columns.map((column) => ({ value: column.id, label: column.title }))}
                onChange={setSelectedColumnId}
              />
            </div>
          </div>
        </fieldset>

        <div className="popup-task-grid">
          <TaskSection
            title="Родительская задача"
            form={parentForm}
            directories={directories}
            users={directories.users}
            addableStickers={visibleAddableStickers}
            allStickers={addableStickers}
            stickerDraft={parentStickerDraft}
            selectedSticker={selectedParentSticker}
            onFormChange={setParentForm}
            onStickerDraftChange={setParentStickerDraft}
            onAddSticker={() => handleAddSticker('parent')}
            onRemoveSticker={(stickerId) => setParentForm((current) => removeStickerFromForm(current, stickerId))}
            showTitleMode={false}
            showParentFlag
            showBoardTitleFlag={false}
            showStartDate
            hasParentSticker={Boolean(parentSticker)}
          />

          <fieldset className="popup-child-card">
            <legend>Подзадача</legend>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={includeChild}
                onChange={(event) => setIncludeChild(event.target.checked)}
              />
              Создать подзадачу
            </label>
            {includeChild ? (
              <TaskSectionBody
                title="Подзадача"
                form={childForm}
                directories={directories}
                users={directories.users}
                addableStickers={visibleAddableStickers}
                allStickers={addableStickers}
                stickerDraft={childStickerDraft}
                selectedSticker={selectedChildSticker}
                onFormChange={setChildForm}
                onStickerDraftChange={setChildStickerDraft}
                onAddSticker={() => handleAddSticker('child')}
                onRemoveSticker={(stickerId) => setChildForm((current) => removeStickerFromForm(current, stickerId))}
                showTitleMode
                showParentFlag={false}
                showBoardTitleFlag={false}
                showStartDate={false}
                hasParentSticker={Boolean(parentSticker)}
              />
            ) : (
              <p className="hint-text">Будет создана только родительская задача.</p>
            )}
          </fieldset>
        </div>

        <fieldset className="popup-options-card">
          <legend>Быстрые опции</legend>
          <div className="details-field">
            Шаблон
            <SearchableSelect
              value={selectedTemplateId}
              placeholder="Выберите шаблон"
              searchPlaceholder="Поиск шаблона"
              options={popupTemplates.map((template) => ({
                value: template.id,
                label: template.title,
              }))}
              onChange={handleTemplateChange}
            />
          </div>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={Boolean(parentForm.includeBoardTitleInTitle)}
              disabled={!selectedBoardTitle}
              onChange={(event) => {
                const checked = event.target.checked;
                setParentForm((current) => ({
                  ...current,
                  includeBoardTitleInTitle: checked,
                  title: checked ? current.title : removeBoardTitlePrefix(current.title, selectedBoardTitle),
                }));
              }}
            />
            Добавлять доску в название родителя
          </label>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={autoProjectStickerEnabled && Boolean(projectStickerMatch)}
              disabled={!selectedBoardTitle}
              onChange={(event) => {
                const checked = event.target.checked;
                setParentForm((current) => ({
                  ...removeProjectStickerFromForm(current, projectStickerOption?.id),
                  autoProjectStickerEnabled: checked,
                }));
                setChildForm((current) => ({
                  ...removeProjectStickerFromForm(current, projectStickerOption?.id),
                  autoProjectStickerEnabled: checked,
                }));
              }}
            />
            Проект по доске
            {projectStickerError ? (
              <span className="inline-error-help" tabIndex={0} aria-label={projectStickerError}>
                !
                <span role="tooltip">{projectStickerError}</span>
              </span>
            ) : null}
          </label>
          {autoProjectStickerEnabled && projectStickerMatch && projectStickerOption ? (
            <span className="selected-stickers compact-chip">
              <button type="button" disabled>
                Проект: {projectStickerOption.states.find((state) => state.id === projectStickerMatch.stateId)?.name}
              </button>
            </span>
          ) : null}
        </fieldset>

        <section className="popup-preview">
          <strong>Предпросмотр</strong>
          <span>{titleMap.get('root') || 'Родитель без названия'}</span>
          {includeChild ? (
            <span className="child-preview">└ {titleMap.get('child') || 'Подзадача без названия'}</span>
          ) : null}
        </section>

        <IssueList title="Ошибки" issues={validation.errors} kind="error" />
        <IssueList title="Предупреждения" issues={validation.warnings} kind="warning" />

        <div className="popup-status">{statusMessage}</div>
        {areDirectoriesStale(directories.lastSyncAt) ? (
          <div className="popup-warning">Справочники старше 24 часов. Лучше обновить их перед реальным созданием.</div>
        ) : null}

        {createdPayloads.length ? (
          <section className="payload-preview">
            <strong>Mock payload порядок</strong>
            {createdPayloads.map((item, index) => (
              <pre key={`${item.localId}-${index}`}>{JSON.stringify(item.payload, null, 2)}</pre>
            ))}
          </section>
        ) : null}

        {creationSummary ? (
          <CreationResult summary={creationSummary} onRetry={handleRetryFailed} />
        ) : null}
      </form>
    </AppShell>
  );
}

function CreationResult(props: { summary: TaskTreeCreationSummary; onRetry: () => void }) {
  return (
    <section className="creation-result">
      <div className="creation-result-header">
        <strong>
          Создано: {props.summary.created} · Ошибок: {props.summary.errors}
        </strong>
        <button type="button" onClick={props.onRetry} disabled={!props.summary.errors}>
          Повторить неуспешные
        </button>
      </div>
      <div className="creation-result-table">
        {props.summary.items.map((item) => (
          <div key={item.localId} className={`creation-result-row ${item.status}`}>
            <span>{item.localId}</span>
            <span>{item.title || 'Без названия'}</span>
            <span>{item.status}</span>
            <span>{item.yougileTaskId ?? '-'}</span>
            <span>{item.error ?? '-'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function isExtensionRuntimeAvailable(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.sendMessage);
}

function TaskSection(props: {
  title: string;
  form: TaskFormState;
  directories: DirectoriesCache;
  users: DirectoriesCache['users'];
  addableStickers: AddableStickerOption[];
  allStickers: AddableStickerOption[];
  stickerDraft: StickerDraft;
  selectedSticker?: AddableStickerOption;
  onFormChange: React.Dispatch<React.SetStateAction<TaskFormState>>;
  onStickerDraftChange: React.Dispatch<React.SetStateAction<StickerDraft>>;
  onAddSticker: () => void;
  onRemoveSticker: (stickerId: string) => void;
  showTitleMode: boolean;
  showParentFlag: boolean;
  showBoardTitleFlag: boolean;
  showStartDate: boolean;
  hasParentSticker: boolean;
}) {
  return (
    <fieldset>
      <legend>{props.title}</legend>
      <TaskSectionBody {...props} />
    </fieldset>
  );
}

function TaskSectionBody(props: {
  title: string;
  form: TaskFormState;
  directories: DirectoriesCache;
  users: DirectoriesCache['users'];
  addableStickers: AddableStickerOption[];
  allStickers: AddableStickerOption[];
  stickerDraft: StickerDraft;
  selectedSticker?: AddableStickerOption;
  onFormChange: React.Dispatch<React.SetStateAction<TaskFormState>>;
  onStickerDraftChange: React.Dispatch<React.SetStateAction<StickerDraft>>;
  onAddSticker: () => void;
  onRemoveSticker: (stickerId: string) => void;
  showTitleMode: boolean;
  showParentFlag: boolean;
  showBoardTitleFlag: boolean;
  showStartDate: boolean;
  hasParentSticker: boolean;
}) {
  const selectedSticker = props.selectedSticker;
  const selectedStateSticker = selectedSticker?.kind === 'state' ? selectedSticker : undefined;

  return (
    <>
      {props.showTitleMode ? (
        <div className="popup-field">
          Режим названия
          <SearchableSelect
            value={props.form.titleMode}
            placeholder="Режим названия"
            searchPlaceholder="Поиск режима"
            options={[
              { value: 'copy_parent', label: 'Скопировать название родителя' },
              { value: 'copy_parent_and_extend', label: 'Скопировать и дополнить' },
              { value: 'custom', label: 'Ввести самостоятельно' },
            ]}
            onChange={(value) =>
              props.onFormChange((current) => ({ ...current, titleMode: (value || 'custom') as TaskTitleMode }))
            }
          />
        </div>
      ) : null}
      {props.form.titleMode === 'custom' ? (
        <label>
          Название
          <input
            value={props.form.title}
            onChange={(event) => props.onFormChange((current) => ({ ...current, title: event.target.value }))}
            placeholder={props.title}
          />
        </label>
      ) : null}
      {props.form.titleMode === 'copy_parent_and_extend' ? (
        <label>
          Дополнение к названию
          <input
            value={props.form.titleSuffix}
            onChange={(event) => props.onFormChange((current) => ({ ...current, titleSuffix: event.target.value }))}
            placeholder="Например: подготовить материалы"
          />
        </label>
      ) : null}
      <div className="popup-field">
        Описание
        <DescriptionEditor
          value={props.form.description}
          onChange={(description) => props.onFormChange((current) => ({ ...current, description }))}
        />
      </div>
      <div className="popup-grid two">
        <div className="popup-field">
          Исполнитель
          <SearchableSelect
            value={props.form.executorUserId}
            placeholder="Не выбран"
            searchPlaceholder="Поиск исполнителя"
            options={props.users.map((user) => ({ value: user.id, label: getUserDisplayName(user) }))}
            onChange={(value) => props.onFormChange((current) => ({ ...current, executorUserId: value }))}
          />
        </div>
        <label>
          Дедлайн
          <input
            type="date"
            value={props.form.deadline}
            onChange={(event) => props.onFormChange((current) => ({ ...current, deadline: event.target.value }))}
          />
        </label>
      </div>
      {props.showStartDate ? (
        <label>
          Старт
          <input
            type="date"
            value={props.form.startDate}
            onChange={(event) => props.onFormChange((current) => ({ ...current, startDate: event.target.value }))}
          />
        </label>
      ) : null}
      {props.showParentFlag ? (
        <label className="inline-check">
          <input
            type="checkbox"
            checked={props.form.isParentFlag}
            disabled={!props.hasParentSticker}
            onChange={(event) =>
              props.onFormChange((current) => ({ ...current, isParentFlag: event.target.checked }))
            }
          />
          Родитель
        </label>
      ) : null}
      {props.showBoardTitleFlag ? (
        <label className="inline-check">
          <input
            type="checkbox"
            checked={props.form.includeBoardTitleInTitle}
            onChange={(event) =>
              props.onFormChange((current) => ({ ...current, includeBoardTitleInTitle: event.target.checked }))
            }
          />
          Добавлять доску в название
        </label>
      ) : null}
      <div className="sticker-editor">
        <div className="popup-field">
          Стикер
          <SearchableSelect
            value={props.stickerDraft.stickerId}
            placeholder="Добавить стикер"
            searchPlaceholder="Поиск стикера"
            options={props.addableStickers.map((sticker) => ({ value: sticker.id, label: sticker.name }))}
            onChange={(value) =>
              props.onStickerDraftChange({
                stickerId: value,
                stateId: '',
                numericValue: '',
              })
            }
          />
        </div>
        {selectedStateSticker ? (
          <div className="popup-field">
            Состояние
            <SearchableSelect
              value={props.stickerDraft.stateId}
              placeholder="Выберите состояние"
              searchPlaceholder="Поиск состояния"
              options={(selectedStateSticker.states ?? []).map((state) => ({ value: state.id, label: state.name }))}
              onChange={(value) => props.onStickerDraftChange((current) => ({ ...current, stateId: value }))}
            />
          </div>
        ) : null}
        {selectedSticker?.kind === 'numeric' ? (
          <label>
            Значение
            <input
              inputMode="decimal"
              value={props.stickerDraft.numericValue}
              onChange={(event) =>
                props.onStickerDraftChange((current) => ({ ...current, numericValue: event.target.value }))
              }
              placeholder="0.5"
            />
          </label>
        ) : null}
        <button type="button" onClick={props.onAddSticker} disabled={!canAddSticker(props.stickerDraft, selectedSticker)}>
          Добавить
        </button>
      </div>
      <SelectedStickerList
        form={props.form}
        directories={props.directories}
        stickers={props.allStickers}
        onRemove={props.onRemoveSticker}
      />
    </>
  );
}

function SelectedStickerList(props: {
  form: TaskFormState;
  directories: DirectoriesCache;
  stickers: AddableStickerOption[];
  onRemove: (stickerId: string) => void;
}) {
  const selectedEntries = [
    ...Object.entries(props.form.stateStickers),
    ...Object.entries(props.form.numericStickers),
  ];

  if (!selectedEntries.length) {
    return <span className="hint-text">Стикеры не выбраны.</span>;
  }

  return (
    <div className="selected-stickers">
      {selectedEntries.map(([stickerId, value]) => {
        const sticker = findSelectedStickerDisplay(stickerId, value, props.stickers, props.directories);

        return (
          <button key={stickerId} type="button" onClick={() => props.onRemove(stickerId)}>
            {sticker.name}: {sticker.value}
          </button>
        );
      })}
    </div>
  );
}

function DescriptionEditor(props: { value: string; onChange: (value: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);

  const handleInput = (element: HTMLDivElement | null) => {
    props.onChange(normalizeEditorHtml(element?.innerHTML ?? ''));
  };

  const runCommand = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    handleInput(editorRef.current);
  };

  useEffect(() => {
    if (document.activeElement !== editorRef.current) {
      syncEditorHtml(editorRef.current, props.value);
    }
  }, [props.value]);

  return (
    <div className="description-editor">
      <div className="description-toolbar" aria-label="Форматирование описания">
        <select aria-label="Стиль текста" onChange={(event) => runCommand('formatBlock', event.target.value)} defaultValue="div">
          <option value="div">Текст</option>
          <option value="h3">Заголовок</option>
          <option value="blockquote">Цитата</option>
        </select>
        <button type="button" onClick={() => runCommand('bold')} title="Жирный">
          B
        </button>
        <button type="button" onClick={() => runCommand('italic')} title="Курсив">
          I
        </button>
        <button type="button" onClick={() => runCommand('strikeThrough')} title="Зачеркнутый">
          S
        </button>
        <button type="button" onClick={() => runCommand('underline')} title="Подчеркнутый">
          U
        </button>
        <button type="button" onClick={() => runCommand('insertUnorderedList')} title="Список">
          •
        </button>
        <button type="button" onClick={() => runCommand('insertOrderedList')} title="Нумерация">
          1.
        </button>
        <button
          type="button"
          onClick={() => {
            const url = window.prompt('Ссылка');
            if (url) {
              runCommand('createLink', url);
            }
          }}
          title="Ссылка"
        >
          Link
        </button>
        <button type="button" onClick={() => runCommand('removeFormat')} title="Очистить форматирование">
          Tx
        </button>
      </div>
      <div
        ref={editorRef}
        className="description-input"
        contentEditable
        role="textbox"
        aria-label="Описание"
        data-placeholder="Описание задачи"
        onInput={(event) => handleInput(event.currentTarget)}
        onBlur={(event) => handleInput(event.currentTarget)}
      />
    </div>
  );
}

function syncEditorHtml(element: HTMLDivElement | null, value: string) {
  if (!element || element.innerHTML === value) {
    return;
  }

  element.innerHTML = value;
}

function normalizeEditorHtml(value: string): string {
  const trimmed = value.trim();

  if (!trimmed || trimmed === '<br>' || trimmed === '<div><br></div>') {
    return '';
  }

  return trimmed;
}

function SearchableSelect(props: {
  value: string;
  options: SearchableSelectOption[];
  placeholder: string;
  searchPlaceholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedOption = props.options.find((option) => option.value === props.value);
  const normalizedQuery = query.trim().toLocaleLowerCase('ru-RU');
  const filteredOptions = normalizedQuery
    ? props.options.filter((option) => option.label.toLocaleLowerCase('ru-RU').includes(normalizedQuery))
    : props.options;

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!containerRef.current?.contains(event.relatedTarget as Node | null)) {
      setIsOpen(false);
      setQuery('');
    }
  };

  const handleSelect = (value: string) => {
    props.onChange(value);
    setIsOpen(false);
    setQuery('');
  };

  return (
    <div className={`searchable-select ${props.disabled ? 'disabled' : ''}`} ref={containerRef} onBlur={handleBlur}>
      <button
        type="button"
        className="searchable-select-trigger"
        onClick={() => {
          if (!props.disabled) {
            setIsOpen((current) => !current);
          }
        }}
        disabled={props.disabled}
      >
        <span>{selectedOption?.label ?? props.placeholder}</span>
        <span className="searchable-select-chevron">⌄</span>
      </button>
      {isOpen ? (
        <div className="searchable-select-menu">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={props.searchPlaceholder}
            autoFocus
          />
          <button
            type="button"
            className="searchable-select-option"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => handleSelect('')}
          >
            {props.placeholder}
          </button>
          {filteredOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`searchable-select-option ${option.value === props.value ? 'selected' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleSelect(option.value)}
            >
              {option.label}
            </button>
          ))}
          {!filteredOptions.length ? <span className="searchable-select-empty">Ничего не найдено</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function IssueList(props: { title: string; issues: TaskTreeValidationIssue[]; kind: 'error' | 'warning' }) {
  if (!props.issues.length) {
    return null;
  }

  return (
    <section className={`issue-list ${props.kind}`}>
      <strong>{props.title}</strong>
      {props.issues.map((issue, index) => (
        <span key={`${issue.code}-${issue.localId ?? 'root'}-${index}`}>{issue.message}</span>
      ))}
    </section>
  );
}

function getDefaultSelection(directories: DirectoriesCache) {
  const firstProject = directories.projects[0];
  const firstBoard = firstProject ? filterBoardsByProject(directories.boards, firstProject.id)[0] : undefined;
  const firstColumn = firstBoard ? filterColumnsByBoard(directories.columns, firstBoard.id)[0] : undefined;

  return {
    projectId: firstProject?.id ?? '',
    boardId: firstBoard?.id ?? '',
    columnId: firstColumn?.id ?? '',
  };
}

function normalizePopupSelection(
  draft: Awaited<ReturnType<typeof readPopupFormDraft<TaskFormState, StickerDraft>>>,
  directories: DirectoriesCache,
  fallback: { projectId: string; boardId: string; columnId: string },
) {
  const project = directories.projects.find((item) => item.id === draft?.selectedProjectId);
  const board = project
    ? filterBoardsByProject(directories.boards, project.id).find((item) => item.id === draft?.selectedBoardId)
    : undefined;
  const column = board
    ? filterColumnsByBoard(directories.columns, board.id).find((item) => item.id === draft?.selectedColumnId)
    : undefined;

  return {
    projectId: project?.id ?? fallback.projectId,
    boardId: board?.id ?? fallback.boardId,
    columnId: column?.id ?? fallback.columnId,
  };
}

function normalizeTaskFormState(value: Partial<TaskFormState> | undefined, fallback: TaskFormState): TaskFormState {
  const titleMode = value?.titleMode;

  return {
    ...fallback,
    ...value,
    title: typeof value?.title === 'string' ? value.title : fallback.title,
    titleSuffix: typeof value?.titleSuffix === 'string' ? value.titleSuffix : fallback.titleSuffix,
    description: typeof value?.description === 'string' ? value.description : fallback.description,
    executorUserId: typeof value?.executorUserId === 'string' ? value.executorUserId : fallback.executorUserId,
    deadline: typeof value?.deadline === 'string' ? value.deadline : fallback.deadline,
    startDate: typeof value?.startDate === 'string' ? value.startDate : fallback.startDate,
    isParentFlag: typeof value?.isParentFlag === 'boolean' ? value.isParentFlag : fallback.isParentFlag,
    includeBoardTitleInTitle:
      typeof value?.includeBoardTitleInTitle === 'boolean'
        ? value.includeBoardTitleInTitle
        : fallback.includeBoardTitleInTitle,
    autoProjectStickerEnabled:
      typeof value?.autoProjectStickerEnabled === 'boolean'
        ? value.autoProjectStickerEnabled
        : fallback.autoProjectStickerEnabled,
    titleMode:
      titleMode === 'custom' || titleMode === 'copy_parent' || titleMode === 'copy_parent_and_extend'
        ? titleMode
        : fallback.titleMode,
    stateStickers: isStringRecord(value?.stateStickers) ? value.stateStickers : fallback.stateStickers,
    numericStickers: isStringRecord(value?.numericStickers) ? value.numericStickers : fallback.numericStickers,
  };
}

function taskNodeToPopupForm(node: TaskNode, fallback: TaskFormState): TaskFormState {
  return normalizeTaskFormState(
    {
      title: node.title,
      titleSuffix: node.titleSuffix,
      description: node.description,
      executorUserId: node.executorUserId,
      deadline: node.deadline,
      startDate: node.startDate,
      isParentFlag: node.isParentFlag,
      includeBoardTitleInTitle: node.includeBoardTitleInTitle,
      autoProjectStickerEnabled: node.autoProjectStickerEnabled,
      titleMode: node.titleMode,
      stateStickers: node.stickers,
      numericStickers: node.numericStickers,
    },
    fallback,
  );
}

function isPopupCompatibleTemplate(template: TaskTreeTemplate): boolean {
  if (template.root.children.length > 1) {
    return false;
  }

  const child = template.root.children[0];

  return !child || child.children.length === 0;
}

function normalizeStickerDraft(value: Partial<StickerDraft> | undefined): StickerDraft {
  return {
    stickerId: typeof value?.stickerId === 'string' ? value.stickerId : '',
    stateId: typeof value?.stateId === 'string' ? value.stateId : '',
    numericValue: typeof value?.numericValue === 'string' ? value.numericValue : '',
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((item) => typeof item === 'string')
  );
}

function buildTwoLevelTree(input: {
  parentForm: TaskFormState;
  childForm: TaskFormState;
  includeChild: boolean;
  directories: DirectoriesCache;
  selectedProjectId: string;
  selectedBoardId: string;
  selectedColumnId: string;
  parentSticker: { stickerId: string; stateId: string } | null;
  projectSticker?: ProjectStickerMatch;
  projectStickerId?: string;
}): TaskNode {
  const project = input.directories.projects.find((item) => item.id === input.selectedProjectId);
  const board = input.directories.boards.find((item) => item.id === input.selectedBoardId);
  const column = input.directories.columns.find((item) => item.id === input.selectedColumnId);
  const parentExecutor = input.directories.users.find((item) => item.id === input.parentForm.executorUserId);
  const childExecutor = input.directories.users.find((item) => item.id === input.childForm.executorUserId);
  const parentStickers = applyProjectSticker(
    {
      ...input.parentForm.stateStickers,
      ...(input.parentSticker ? { [input.parentSticker.stickerId]: input.parentSticker.stateId } : {}),
    },
    input.projectSticker,
    input.projectStickerId,
  );
  const childStickers = applyProjectSticker(
    input.childForm.stateStickers,
    input.projectSticker,
    input.projectStickerId,
  );

  const child: TaskNode = {
    localId: 'child',
    parentLocalId: 'root',
    level: 1,
    order: 0,
    titleMode: input.childForm.titleMode,
    title: input.childForm.title,
    titleSuffix: input.childForm.titleSuffix,
    description: input.childForm.description,
    projectTitle: project?.title,
    projectId: input.selectedProjectId,
    boardId: input.selectedBoardId,
    boardTitle: board?.title,
    includeBoardTitleInTitle: input.childForm.includeBoardTitleInTitle,
    autoProjectStickerEnabled: input.parentForm.autoProjectStickerEnabled,
    executorUserId: input.childForm.executorUserId || undefined,
    executorName: childExecutor ? getUserDisplayName(childExecutor) : undefined,
    deadline: input.childForm.deadline || undefined,
    startDate: undefined,
    stickers: childStickers,
    numericStickers: input.childForm.numericStickers,
    children: [],
    status: 'draft',
  };

  return {
    localId: 'root',
    parentLocalId: null,
    level: 0,
    order: 0,
    titleMode: 'custom',
    title: input.parentForm.title,
    description: input.parentForm.description,
    projectTitle: project?.title,
    projectId: input.selectedProjectId,
    boardId: input.selectedBoardId,
    boardTitle: board?.title,
    includeBoardTitleInTitle: input.parentForm.includeBoardTitleInTitle,
    autoProjectStickerEnabled: input.parentForm.autoProjectStickerEnabled,
    columnId: input.selectedColumnId,
    columnTitle: column?.title,
    executorUserId: input.parentForm.executorUserId || undefined,
    executorName: parentExecutor ? getUserDisplayName(parentExecutor) : undefined,
    deadline: input.parentForm.deadline || undefined,
    startDate: input.parentForm.startDate || undefined,
    isParentFlag: input.parentForm.isParentFlag,
    hasStartDateFlag: Boolean(input.parentForm.startDate),
    stickers: parentStickers,
    numericStickers: input.parentForm.numericStickers,
    children: input.includeChild ? [child] : [],
    status: 'draft',
  };
}

function applyProjectSticker(
  stickers: Record<string, string>,
  projectSticker?: ProjectStickerMatch,
  projectStickerId?: string,
): Record<string, string> {
  const stickerIdToRemove = projectSticker?.stickerId ?? projectStickerId;
  const stickersWithoutProject = stickerIdToRemove ? removeRecordKey(stickers, stickerIdToRemove) : stickers;

  return projectSticker
    ? {
        ...stickersWithoutProject,
        [projectSticker.stickerId]: projectSticker.stateId,
      }
    : stickersWithoutProject;
}

function removeRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

function getProjectStickerOption(stickers: AddableStickerOption[]): StateStickerOption | undefined {
  return stickers.find((sticker): sticker is StateStickerOption => isProjectStickerOption(sticker));
}

function isProjectStickerOption(sticker: AddableStickerOption): sticker is StateStickerOption {
  return sticker.kind === 'state' && normalizeStickerMatchText(sticker.name) === 'проект';
}

function findProjectStickerMatch(stickers: AddableStickerOption[], boardTitle?: string): ProjectStickerMatch | undefined {
  const normalizedBoardTitle = normalizeStickerMatchText(boardTitle);
  if (!normalizedBoardTitle) {
    return undefined;
  }

  const projectSticker = getProjectStickerOption(stickers);
  const state = projectSticker?.states.find((item) => normalizeStickerMatchText(item.name) === normalizedBoardTitle);

  return projectSticker && state
    ? {
        stickerId: projectSticker.id,
        stateId: state.id,
      }
    : undefined;
}

function normalizeStickerMatchText(value?: string): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

function findSelectedStickerDisplay(
  stickerId: string,
  value: string,
  boardStickers: AddableStickerOption[],
  directories: DirectoriesCache,
): { name: string; value: string } {
  const boardSticker = boardStickers.find((item) => item.id === stickerId);

  if (boardSticker?.kind === 'state') {
    return {
      name: boardSticker.name,
      value: boardSticker.states.find((state) => state.id === value)?.name ?? value,
    };
  }

  if (boardSticker?.kind === 'numeric') {
    return {
      name: boardSticker.name,
      value,
    };
  }

  const directorySticker = directories.stickers.find((item) => item.id === stickerId);

  if (directorySticker) {
    return {
      name: directorySticker.name,
      value: directorySticker.states.find((state) => state.id === value)?.name ?? value,
    };
  }

  const numericSticker = directories.boardStickerConfig
    .flatMap((config) => config.numeric)
    .find((item) => item.id === stickerId);

  return {
    name: numericSticker?.title ?? stickerId,
    value,
  };
}

function removeProjectStickerFromForm(form: TaskFormState, projectStickerId?: string): TaskFormState {
  if (!projectStickerId) {
    return form;
  }

  return removeStickerFromForm(form, projectStickerId);
}

function removeBoardTitlePrefix(title: string, boardTitle?: string): string {
  const normalizedBoardTitle = boardTitle?.trim();
  const normalizedTitle = title.trim();

  if (!normalizedBoardTitle) {
    return title;
  }

  if (normalizedTitle === normalizedBoardTitle) {
    return '';
  }

  if (normalizedTitle.startsWith(`${normalizedBoardTitle} / `)) {
    return normalizedTitle.slice(`${normalizedBoardTitle} / `.length);
  }

  return title;
}

function buildValidationContext(directories: DirectoriesCache): TaskTreeValidationContext {
  return {
    directoriesAreStale: areDirectoriesStale(directories.lastSyncAt),
    knownProjectIds: new Set(directories.projects.map((item) => item.id)),
    knownBoardIds: new Set(directories.boards.map((item) => item.id)),
    knownColumnIds: new Set(directories.columns.map((item) => item.id)),
    knownUserIds: new Set(directories.users.map((item) => item.id)),
    knownStickerIds: new Set([
      ...directories.stickers.map((item) => item.id),
      ...directories.boardStickerConfig.flatMap((item) => (item.numeric ?? []).map((sticker) => sticker.id)),
    ]),
    knownStateIds: new Set(directories.stickers.flatMap((item) => (item.states ?? []).map((state) => state.id))),
  };
}

function addStickerToForm(form: TaskFormState, option: AddableStickerOption, draft: StickerDraft): TaskFormState {
  if (option.kind === 'numeric') {
    return {
      ...form,
      numericStickers: {
        ...form.numericStickers,
        [option.id]: draft.numericValue.replace(',', '.'),
      },
    };
  }

  return {
    ...form,
    stateStickers: {
      ...form.stateStickers,
      [option.id]: draft.stateId,
    },
  };
}

function removeStickerFromForm(form: TaskFormState, stickerId: string): TaskFormState {
  const { [stickerId]: _stateValue, ...stateStickers } = form.stateStickers;
  const { [stickerId]: _numericValue, ...numericStickers } = form.numericStickers;

  return {
    ...form,
    stateStickers,
    numericStickers,
  };
}

function cloneNode(node: TaskNode): TaskNode {
  return {
    ...node,
    stickers: { ...node.stickers },
    numericStickers: { ...(node.numericStickers ?? {}) },
    children: node.children.map(cloneNode),
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message?: unknown }).message);
  }

  return 'Неизвестная ошибка создания задач.';
}

function canAddSticker(draft: StickerDraft, option?: AddableStickerOption): boolean {
  if (!option) {
    return false;
  }

  if (option.kind === 'numeric') {
    return draft.numericValue.trim().length > 0;
  }

  return Boolean(draft.stateId);
}

function resetStickerSelection(
  setParentForm: React.Dispatch<React.SetStateAction<TaskFormState>>,
  setChildForm: React.Dispatch<React.SetStateAction<TaskFormState>>,
  setParentStickerDraft: React.Dispatch<React.SetStateAction<StickerDraft>>,
  setChildStickerDraft: React.Dispatch<React.SetStateAction<StickerDraft>>,
) {
  setParentForm((current) => ({ ...current, stateStickers: {}, numericStickers: {} }));
  setChildForm((current) => ({ ...current, stateStickers: {}, numericStickers: {} }));
  setParentStickerDraft(emptyStickerDraft);
  setChildStickerDraft(emptyStickerDraft);
}
