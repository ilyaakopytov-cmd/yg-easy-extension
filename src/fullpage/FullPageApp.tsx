import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import type { CreateTaskPayload, CreatedTask } from '../api/tasksApi';
import { getUserDisplayName } from '../api/usersApi';
import {
  sendBackgroundMessage,
  type BackgroundResponse,
  type CreateYouGileTaskTreeResult,
  type SyncDirectoriesProgressMessage,
} from '../background/messages';
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
import { readPopupDraft } from '../storage/popupDraftStorage';
import {
  deleteTemplate,
  readTemplates,
  TASK_TREE_TEMPLATE_FORMAT,
  TASK_TREE_TEMPLATE_VERSION,
  upsertTemplate,
  writeTemplates,
  type TaskTreeTemplate,
} from '../storage/templatesStorage';
import { buildSingleTemplateExport, buildTemplatesExport } from '../templates/templateExport';
import { parseTemplatesImportDocument, type TemplateImportResult } from '../templates/templateImport';
import { prepareTaskTreeTemplateRoot } from '../templates/templateNormalizer';
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
import './fullpage.css';

type SyncDirectoriesResult = {
  directories: DirectoriesCache;
  counts: {
    projects: number;
    boards: number;
    linkedBoards?: number;
    columns: number;
    users: number;
    departments: number;
    stickers: number;
  };
};

type StickerDraft = {
  stickerId: string;
  stateId: string;
  numericValue: string;
};

type MockCreatedTask = CreatedTask & {
  payload: CreateTaskPayload;
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

const emptyStickerDraft: StickerDraft = {
  stickerId: '',
  stateId: '',
  numericValue: '',
};

const RATE_LIMIT_SYNC_MESSAGE = 'Обновление займёт больше времени, из-за ограничений на стороне YouGile';

export function FullPageApp() {
  const [directories, setDirectories] = useState<DirectoriesCache>(EMPTY_DIRECTORIES_CACHE);
  const [root, setRoot] = useState<TaskNode>(() => createBlankRoot());
  const [selectedLocalId, setSelectedLocalId] = useState('root');
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [stickerDraft, setStickerDraft] = useState<StickerDraft>(emptyStickerDraft);
  const [syncMessage, setSyncMessage] = useState('Справочники пока не обновлялись в этой сессии.');
  const [creationMessage, setCreationMessage] = useState('Дерево пока не создавалось.');
  const [templateMessage, setTemplateMessage] = useState('Шаблоны пока не загружены.');
  const [templateTitle, setTemplateTitle] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateProjectTraitsIncluded, setTemplateProjectTraitsIncluded] = useState(true);
  const [templates, setTemplates] = useState<TaskTreeTemplate[]>([]);
  const [createdPayloads, setCreatedPayloads] = useState<Array<{ localId: string; payload: CreateTaskPayload }>>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const templateImportInputRef = useRef<HTMLInputElement | null>(null);

  const nodes = useMemo(() => flattenTaskTree(root), [root]);
  const selectedNode = useMemo(
    () => nodes.find((node) => node.localId === selectedLocalId) ?? root,
    [nodes, root, selectedLocalId],
  );
  const boards = useMemo(
    () => filterBoardsByProject(directories.boards, selectedNode.projectId ?? ''),
    [directories.boards, selectedNode.projectId],
  );
  const columns = useMemo(
    () => filterColumnsByBoard(directories.columns, selectedNode.boardId ?? ''),
    [directories.columns, selectedNode.boardId],
  );
  const addableStickers = useMemo(
    () => getAddableStickerOptions(selectedNode.boardId ?? '', directories.stickers, directories.boardStickerConfig),
    [directories.boardStickerConfig, directories.stickers, selectedNode.boardId],
  );
  const parentSticker = useMemo(() => getParentStickerConfig(directories.stickers), [directories.stickers]);
  const projectStickerId = useMemo(() => getProjectStickerId(directories), [directories]);
  const titleMap = useMemo(() => buildTitleMap(root), [root]);
  const validationContext = useMemo(() => buildValidationContext(directories), [directories]);
  const validation = useMemo(() => validateTaskTree(root, validationContext), [root, validationContext]);
  const creationSummary = useMemo(() => summarizeTaskTreeCreation(root), [root]);
  const isDirectoriesStale = areDirectoriesStale(directories.lastSyncAt);
  const selectedSticker = addableStickers.find((sticker) => sticker.id === stickerDraft.stickerId);

  useEffect(() => {
    let isMounted = true;

    async function restoreDirectoriesCache() {
      const cachedDirectories = await readDirectoriesCache();
      const popupDraft = await readPopupDraft();
      const storedTemplates = await readTemplates();

      if (!isMounted) {
        return;
      }

      const firstProject = cachedDirectories.projects[0];
      const firstBoard = firstProject
        ? filterBoardsByProject(cachedDirectories.boards, firstProject.id)[0]
        : undefined;
      const firstColumn = firstBoard
        ? filterColumnsByBoard(cachedDirectories.columns, firstBoard.id)[0]
        : undefined;
      const restoredRoot =
        popupDraft?.root ??
        createBlankRoot({
          projectId: firstProject?.id,
          projectTitle: firstProject?.title,
          boardId: firstBoard?.id,
          boardTitle: firstBoard?.title,
          columnId: firstColumn?.id,
          columnTitle: firstColumn?.title,
        });

      setDirectories(cachedDirectories);
      setTemplates(storedTemplates);
      setSelectedTemplateId(storedTemplates[0]?.id ?? '');
      setTemplateTitle(storedTemplates[0]?.title ?? '');
      setTemplateProjectTraitsIncluded(storedTemplates[0]?.projectTraitsIncluded ?? true);
      setRoot(normalizeTree(restoredRoot));
      setSelectedLocalId(restoredRoot.localId);
      setSyncMessage(
        popupDraft?.root
          ? `Передан черновик из popup: ${popupDraft.root.title || popupDraft.root.localId}.`
          : cachedDirectories.lastSyncAt
            ? 'Справочники восстановлены из кэша.'
            : 'Справочники не найдены. Обновите mock или YouGile.',
      );
      setTemplateMessage(
        storedTemplates.length
          ? `Загружено шаблонов: ${storedTemplates.length}.`
          : 'Шаблонов пока нет. Сохраните текущее дерево как шаблон.',
      );
    }

    void restoreDirectoriesCache();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) {
      return undefined;
    }

    const handleMessage = (message: SyncDirectoriesProgressMessage) => {
      if (message?.type === 'YG_EASY_SYNC_DIRECTORIES_PROGRESS' && message.status === 'rate_limited') {
        setSyncMessage(RATE_LIMIT_SYNC_MESSAGE);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  const handleSyncYouGileDirectories = async () => {
    setIsSyncing(true);
    setSyncMessage('Обновляем справочники из YouGile...');

    const response: BackgroundResponse<SyncDirectoriesResult> = await sendBackgroundMessage({
      type: 'YG_EASY_SYNC_DIRECTORIES',
    });

    setIsSyncing(false);

    if (!response.ok) {
      setSyncMessage(`Ошибка обновления справочников: ${response.error}`);
      return;
    }

    setDirectories(response.data.directories);
    setRoot((current) => applyDefaultDirectories(current, response.data.directories));
    setSyncMessage(
      `Справочники обновлены: проектов ${response.data.counts.projects}, досок ${response.data.counts.boards}, привязано к проектам ${response.data.counts.linkedBoards ?? 0}, колонок ${response.data.counts.columns}.`,
    );
  };

  const handleOpenOptions = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
      return;
    }

    window.open('/src/options/options.html', '_blank', 'noopener,noreferrer');
  };

  const updateSelectedNode = (updater: (node: TaskNode) => TaskNode) => {
    setRoot((current) => updateNode(current, selectedLocalId, updater));
    setCreatedPayloads([]);
  };

  const handleAddRoot = () => {
    const nextRoot = createBlankRoot(getRootDirectoryDefaults(root));
    setRoot(nextRoot);
    setSelectedLocalId(nextRoot.localId);
    setCollapsedIds(new Set());
    setCreatedPayloads([]);
  };

  const handleAddChild = () => {
    const childId = makeLocalId();
    setRoot((current) =>
      updateNode(current, selectedLocalId, (node) => ({
        ...node,
        children: [
          ...node.children,
          createBlankNode({
            parent: node,
            localId: childId,
            order: node.children.length,
          }),
        ],
      })),
    );
    setSelectedLocalId(childId);
    setCreatedPayloads([]);
  };

  const handleAddSibling = () => {
    if (!selectedNode.parentLocalId) {
      handleAddChild();
      return;
    }

    const siblingId = makeLocalId();
    setRoot((current) =>
      updateNode(current, selectedNode.parentLocalId ?? current.localId, (parent) => ({
        ...parent,
        children: normalizeSiblingOrder([
          ...parent.children,
          createBlankNode({
            parent,
            localId: siblingId,
            order: parent.children.length,
          }),
        ]),
      })),
    );
    setSelectedLocalId(siblingId);
    setCreatedPayloads([]);
  };

  const handleMove = (direction: 'up' | 'down') => {
    if (!selectedNode.parentLocalId) {
      return;
    }

    setRoot((current) =>
      updateNode(current, selectedNode.parentLocalId ?? current.localId, (parent) => ({
        ...parent,
        children: moveChild(parent.children, selectedLocalId, direction),
      })),
    );
    setCreatedPayloads([]);
  };

  const handleIndent = () => {
    if (!selectedNode.parentLocalId) {
      return;
    }

    const parent = findNode(root, selectedNode.parentLocalId);
    const siblings = parent?.children ?? [];
    const selectedIndex = siblings.findIndex((node) => node.localId === selectedLocalId);
    const previousSibling = selectedIndex > 0 ? siblings[selectedIndex - 1] : undefined;

    if (!previousSibling) {
      return;
    }

    setRoot((current) => indentNode(current, selectedLocalId));
    setCreatedPayloads([]);
  };

  const handleOutdent = () => {
    if (!selectedNode.parentLocalId) {
      return;
    }

    const parent = findNode(root, selectedNode.parentLocalId);
    if (!parent?.parentLocalId) {
      return;
    }

    setRoot((current) => outdentNode(current, selectedLocalId));
    setCreatedPayloads([]);
  };

  const handleDuplicate = (withBranch: boolean) => {
    const source = findNode(root, selectedLocalId);
    if (!source) {
      return;
    }

    const duplicate = duplicateNode(source, source.parentLocalId, withBranch);

    if (!source.parentLocalId) {
      setRoot(normalizeTree(duplicate));
      setSelectedLocalId(duplicate.localId);
      return;
    }

    setRoot((current) =>
      updateNode(current, source.parentLocalId ?? current.localId, (parent) => ({
        ...parent,
        children: normalizeSiblingOrder([...parent.children, duplicate]),
      })),
    );
    setSelectedLocalId(duplicate.localId);
    setCreatedPayloads([]);
  };

  const handleDelete = (withBranch: boolean) => {
    if (!selectedNode.parentLocalId) {
      handleAddRoot();
      return;
    }

    const nextSelectedId = selectedNode.parentLocalId;
    setRoot((current) => deleteNode(current, selectedLocalId, withBranch));
    setSelectedLocalId(nextSelectedId);
    setCreatedPayloads([]);
  };

  const handleToggleCollapse = (localId: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(localId)) {
        next.delete(localId);
      } else {
        next.add(localId);
      }
      return next;
    });
  };

  const handleAddSticker = () => {
    if (!selectedSticker) {
      return;
    }

    updateSelectedNode((node) => addStickerToNode(node, selectedSticker, stickerDraft));
    setStickerDraft(emptyStickerDraft);
  };

  const handleRemoveSticker = (stickerId: string) => {
    updateSelectedNode((node) => removeStickerFromNode(node, stickerId));
  };

  const handleCreateTasks = async () => {
    await createTasksFromRoot(prepareFreshCreationRoot(root));
  };

  const handleRetryFailed = async () => {
    await createTasksFromRoot(root);
  };

  const handleSaveTemplate = async () => {
    const title = templateTitle.trim() || titleMap.get(root.localId)?.trim() || 'Новый шаблон';
    const now = new Date().toISOString();
    const template: TaskTreeTemplate = {
      format: TASK_TREE_TEMPLATE_FORMAT,
      version: TASK_TREE_TEMPLATE_VERSION,
      id: makeTemplateId(),
      title,
      projectTraitsIncluded: templateProjectTraitsIncluded,
      root: prepareTemplateRoot(root, templateProjectTraitsIncluded, projectStickerId),
      createdAt: now,
      updatedAt: now,
    };
    const nextTemplates = await upsertTemplate(template);

    setTemplates(nextTemplates);
    setSelectedTemplateId(template.id);
    setTemplateTitle(template.title);
    setTemplateMessage(`Шаблон сохранен: ${template.title}.`);
  };

  const handleUpdateTemplate = async () => {
    const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
    if (!selectedTemplate) {
      setTemplateMessage('Выберите шаблон для обновления.');
      return;
    }

    const title = templateTitle.trim() || selectedTemplate.title;
    const updatedTemplate: TaskTreeTemplate = {
      ...selectedTemplate,
      title,
      projectTraitsIncluded: templateProjectTraitsIncluded,
      root: prepareTemplateRoot(root, templateProjectTraitsIncluded, projectStickerId),
      updatedAt: new Date().toISOString(),
    };
    const nextTemplates = await upsertTemplate(updatedTemplate);

    setTemplates(nextTemplates);
    setTemplateTitle(updatedTemplate.title);
    setTemplateMessage(`Шаблон обновлен: ${updatedTemplate.title}.`);
  };

  const handleLoadTemplate = () => {
    const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
    if (!selectedTemplate) {
      setTemplateMessage('Выберите шаблон для загрузки.');
      return;
    }

    const nextRoot = instantiateTemplateRoot(selectedTemplate.root, getRootDirectoryDefaults(root));
    setRoot(nextRoot);
    setSelectedLocalId(nextRoot.localId);
    setCollapsedIds(new Set());
    setCreatedPayloads([]);
    setCreationMessage('Дерево загружено из шаблона и готово к редактированию.');
    setTemplateTitle(selectedTemplate.title);
    setTemplateProjectTraitsIncluded(selectedTemplate.projectTraitsIncluded ?? true);
    setTemplateMessage(`Шаблон загружен: ${selectedTemplate.title}.`);
  };

  const handleCreateFromTemplate = async () => {
    const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
    if (!selectedTemplate) {
      setTemplateMessage('Выберите шаблон для создания матрешки.');
      return;
    }

    const nextRoot = instantiateTemplateRoot(selectedTemplate.root, getRootDirectoryDefaults(root));
    setRoot(nextRoot);
    setSelectedLocalId(nextRoot.localId);
    setTemplateTitle(selectedTemplate.title);
    setTemplateProjectTraitsIncluded(selectedTemplate.projectTraitsIncluded ?? true);
    setTemplateMessage(`Создание из шаблона: ${selectedTemplate.title}.`);
    await createTasksFromRoot(nextRoot);
  };

  const handleDuplicateTemplate = async () => {
    const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
    if (!selectedTemplate) {
      setTemplateMessage('Выберите шаблон для дублирования.');
      return;
    }

    const now = new Date().toISOString();
    const duplicate: TaskTreeTemplate = {
      ...selectedTemplate,
      id: makeTemplateId(),
      title: `${selectedTemplate.title} копия`,
      projectTraitsIncluded: templateProjectTraitsIncluded,
      root: prepareTemplateRoot(selectedTemplate.root, templateProjectTraitsIncluded, projectStickerId),
      createdAt: now,
      updatedAt: now,
    };
    const nextTemplates = await upsertTemplate(duplicate);

    setTemplates(nextTemplates);
    setSelectedTemplateId(duplicate.id);
    setTemplateTitle(duplicate.title);
    setTemplateProjectTraitsIncluded(duplicate.projectTraitsIncluded);
    setTemplateMessage(`Шаблон продублирован: ${duplicate.title}.`);
  };

  const handleDeleteTemplate = async () => {
    const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
    if (!selectedTemplate) {
      setTemplateMessage('Выберите шаблон для удаления.');
      return;
    }

    const nextTemplates = await deleteTemplate(selectedTemplate.id);
    const nextSelected = nextTemplates[0];

    setTemplates(nextTemplates);
    setSelectedTemplateId(nextSelected?.id ?? '');
    setTemplateTitle(nextSelected?.title ?? '');
    setTemplateProjectTraitsIncluded(nextSelected?.projectTraitsIncluded ?? true);
    setTemplateMessage(`Шаблон удален: ${selectedTemplate.title}.`);
  };

  const handleExportSelectedTemplate = () => {
    const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
    if (!selectedTemplate) {
      setTemplateMessage('Выберите шаблон для экспорта.');
      return;
    }

    downloadJsonFile(
      `yg-easy-template-${sanitizeFileName(selectedTemplate.title)}.json`,
      buildSingleTemplateExport(selectedTemplate, directories),
    );
    setTemplateMessage(`Шаблон экспортирован: ${selectedTemplate.title}.`);
  };

  const handleExportAllTemplates = () => {
    if (!templates.length) {
      setTemplateMessage('Нет шаблонов для экспорта.');
      return;
    }

    downloadJsonFile(`yg-easy-templates-${formatDateFilePart(new Date())}.json`, buildTemplatesExport(templates, directories));
    setTemplateMessage(`Экспортировано шаблонов: ${templates.length}.`);
  };

  const handleImportTemplatesClick = () => {
    templateImportInputRef.current?.click();
  };

  const handleImportTemplateFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';

    if (!files.length) {
      return;
    }

    try {
      const results = await Promise.all(files.map((file) => readTemplateImportFile(file, directories)));
      const importedTemplates = results.flatMap((result) => result.templates);
      const warnings = results.flatMap((result) => result.warnings);
      const unresolvedCount = results.reduce((sum, result) => sum + result.unresolvedCount, 0);

      if (!importedTemplates.length) {
        setTemplateMessage('В выбранных файлах не найдено шаблонов.');
        return;
      }

      const nextTemplates = [...importedTemplates, ...templates];
      await writeTemplates(nextTemplates);

      setTemplates(nextTemplates);
      setSelectedTemplateId(importedTemplates[0].id);
      setTemplateTitle(importedTemplates[0].title);
      setTemplateProjectTraitsIncluded(importedTemplates[0].projectTraitsIncluded);
      setTemplateMessage(
        warnings.length || unresolvedCount
          ? `Импортировано шаблонов: ${importedTemplates.length}. Не сопоставлено: ${unresolvedCount}. ${warnings.slice(0, 2).join(' ')}`
          : `Импортировано шаблонов: ${importedTemplates.length}.`,
      );
    } catch (error) {
      setTemplateMessage(`Ошибка импорта шаблонов: ${getErrorMessage(error)}`);
    }
  };

  const createTasksFromRoot = async (sourceRoot: TaskNode) => {
    setCreatedPayloads([]);

    const sourceValidation = validateTaskTree(sourceRoot, validationContext);

    if (!sourceValidation.isValid) {
      setCreationMessage('Есть критичные ошибки. Создание заблокировано.');
      return;
    }

    const titledSourceRoot = materializeTitlesForCreation(sourceRoot);
    const sourceRootWithParentSticker = parentSticker ? applyParentSticker(titledSourceRoot, parentSticker) : titledSourceRoot;
    const outgoingPayloads = await collectTaskPayloadsForPreview(sourceRootWithParentSticker, validationContext);
    setCreatedPayloads(outgoingPayloads);

    if (isExtensionRuntimeAvailable()) {
      const response = await sendBackgroundMessage<CreateYouGileTaskTreeResult>({
        type: 'YG_EASY_CREATE_TASK_TREE',
        root: sourceRootWithParentSticker,
      });

      if (!response.ok) {
        setCreationMessage(`Ошибка создания через YouGile: ${response.error}`);
        return;
      }

      const responsePayloads = response.data.createdTasks.flatMap((item) =>
        item.payload ? [{ localId: item.localId, payload: item.payload }] : [],
      );

      setRoot(mergeCreationState(sourceRoot, response.data.root));
      setCreatedPayloads(responsePayloads.length ? responsePayloads : outgoingPayloads);
      setCreationMessage(
        response.data.error
          ? `Создание остановлено: ${response.data.error}`
          : `Создание через YouGile готово: создано ${response.data.createdTasks.length}, верхняя задача ${response.data.rootTaskId}. ${getBackgroundDebugMessage(response.data)}`,
      );
      return;
    }

    const draftRoot = cloneNode(sourceRootWithParentSticker);
    const creationOrder = flattenTaskTree(draftRoot)
      .slice()
      .sort((a, b) => b.level - a.level || a.order - b.order)
      .map((node) => node.localId);
    const payloads: Array<{ localId: string; payload: CreateTaskPayload }> = [];
    let counter = 1;

    try {
      const result = await createTaskTree(
        draftRoot,
        async (payload) => {
          const created: MockCreatedTask = {
            id: `mock-task-${counter++}`,
            title: payload.title,
            payload,
          };
          payloads.push({ localId: creationOrder[payloads.length] ?? draftRoot.localId, payload: created.payload });
          return created;
        },
        validationContext,
      );

      setRoot(mergeCreationState(sourceRoot, draftRoot));
      setCreatedPayloads(payloads);
      setCreationMessage(`Mock-создание готово: создано ${result.createdTasks.length}, верхняя задача ${result.rootTaskId}.`);
    } catch (error) {
      setRoot(mergeCreationState(sourceRoot, draftRoot));
      setCreatedPayloads(payloads);
      setCreationMessage(`Mock-создание остановлено: ${getErrorMessage(error)}`);
    }
  };

  return (
    <AppShell
      title="Конструктор дерева задач"
      subtitle="Широкий интерфейс для произвольной иерархии задач YouGile."
    >
      <section className="fullpage-layout">
        <aside className="surface panel nav-panel">
          <h2 className="section-title">Навигация</h2>
          <div className="template-box">
            <strong>Шаблоны</strong>
            <label>
              Имя шаблона
              <input
                value={templateTitle}
                onChange={(event) => setTemplateTitle(event.target.value)}
                placeholder="Например: Доработка отчета"
              />
            </label>
            <div className="template-select-field">
              Выбрать шаблон
              <SearchableSelect
                value={selectedTemplateId}
                placeholder="Нет шаблона"
                searchPlaceholder="Поиск шаблона"
                options={templates.map((template) => ({
                  value: template.id,
                  label: template.title,
                }))}
                onChange={(value) => {
                  const template = templates.find((item) => item.id === value);
                  setSelectedTemplateId(value);
                  setTemplateTitle(template?.title ?? '');
                  setTemplateProjectTraitsIncluded(template?.projectTraitsIncluded ?? true);
                }}
              />
            </div>
            <label className="template-checkbox">
              <input
                type="checkbox"
                checked={templateProjectTraitsIncluded}
                onChange={(event) => setTemplateProjectTraitsIncluded(event.target.checked)}
              />
              Сохранять признаки проекта
            </label>
            <div className="template-actions">
              <input
                ref={templateImportInputRef}
                className="visually-hidden"
                type="file"
                accept="application/json,.json"
                multiple
                onChange={handleImportTemplateFiles}
              />
              <button type="button" onClick={handleSaveTemplate}>
                Сохранить
              </button>
              <button type="button" onClick={handleUpdateTemplate} disabled={!selectedTemplateId}>
                Обновить
              </button>
              <button type="button" onClick={handleLoadTemplate} disabled={!selectedTemplateId}>
                Загрузить
              </button>
              <button type="button" onClick={handleCreateFromTemplate} disabled={!selectedTemplateId}>
                Создать из шаблона
              </button>
              <button type="button" onClick={handleDuplicateTemplate} disabled={!selectedTemplateId}>
                Дублировать
              </button>
              <button type="button" onClick={handleDeleteTemplate} disabled={!selectedTemplateId}>
                Удалить
              </button>
              <button type="button" onClick={handleExportSelectedTemplate} disabled={!selectedTemplateId}>
                Экспорт выбранного
              </button>
              <button type="button" onClick={handleExportAllTemplates} disabled={!templates.length}>
                Экспорт всех
              </button>
              <button type="button" onClick={handleImportTemplatesClick}>
                Импорт
              </button>
            </div>
            <span>{templateMessage}</span>
          </div>
          <button type="button" onClick={handleSyncYouGileDirectories} disabled={isSyncing}>
            {isSyncing ? 'Обновляем...' : 'Обновить из YouGile'}
          </button>
          <button type="button" onClick={handleOpenOptions}>
            Настройки
          </button>
          <div className="sync-status">
            Последнее обновление:{' '}
            {directories.lastSyncAt ? new Date(directories.lastSyncAt).toLocaleString('ru-RU') : 'не выполнялось'}
          </div>
          <div className="sync-status">{syncMessage}</div>
          {isDirectoriesStale ? (
            <div className="sync-warning">Справочники устарели. Рекомендуется обновить перед созданием задач.</div>
          ) : null}
          <div className="mock-summary">
            <span>Проекты: {directories.projects.length}</span>
            <span>Доски: {directories.boards.length}</span>
            <span>Колонки: {directories.columns.length}</span>
            <span>Пользователи: {directories.users.length}</span>
            <span>Стикеры: {directories.stickers.length}</span>
          </div>
        </aside>

        <main className="surface tree-panel">
          <div className="tree-toolbar">
            <ToolbarGroup
              title="Добавить"
              description="Создает новые элементы дерева задач."
              items={[
                'Новая матрешка: очищает текущее дерево и создает новое.',
                'Подзадача: добавляет задачу внутрь выбранной.',
                'Рядом: добавляет задачу на том же уровне, что выбранная.',
              ]}
            >
              <button type="button" onClick={handleAddRoot}>
                Новая матрешка
              </button>
              <button type="button" onClick={handleAddChild}>
                Подзадача
              </button>
              <button type="button" onClick={handleAddSibling}>
                Рядом
              </button>
            </ToolbarGroup>
            <ToolbarGroup
              title="Переместить"
              description="Меняет положение выбранной задачи в дереве."
              items={[
                'Выше: поднимает задачу среди соседей.',
                'Ниже: опускает задачу среди соседей.',
                'Вложить: делает задачу подзадачей предыдущей соседней задачи.',
                'Поднять: выносит задачу на уровень выше.',
              ]}
            >
              <button type="button" onClick={() => handleMove('up')} disabled={!selectedNode.parentLocalId}>
                Выше
              </button>
              <button type="button" onClick={() => handleMove('down')} disabled={!selectedNode.parentLocalId}>
                Ниже
              </button>
              <button type="button" onClick={handleIndent} disabled={!selectedNode.parentLocalId}>
                Вложить
              </button>
              <button type="button" onClick={handleOutdent} disabled={!selectedNode.parentLocalId}>
                Поднять
              </button>
            </ToolbarGroup>
            <ToolbarGroup
              title="Копировать"
              description="Создает копии выбранной задачи."
              items={[
                'Копировать задачу: копирует только выбранную задачу без подзадач.',
                'Копировать ветку: копирует выбранную задачу вместе со всеми подзадачами.',
              ]}
            >
              <button type="button" onClick={() => handleDuplicate(false)}>
                Копировать задачу
              </button>
              <button type="button" onClick={() => handleDuplicate(true)}>
                Копировать ветку
              </button>
            </ToolbarGroup>
            <ToolbarGroup
              title="Удалить"
              description="Удаляет выбранную задачу или всю ее ветку."
              items={[
                'Удалить задачу: удаляет выбранную задачу, а ее подзадачи поднимает выше.',
                'Удалить ветку: удаляет выбранную задачу вместе со всеми подзадачами.',
              ]}
            >
              <button type="button" onClick={() => handleDelete(false)} disabled={!selectedNode.parentLocalId}>
                Удалить задачу
              </button>
              <button type="button" onClick={() => handleDelete(true)} disabled={!selectedNode.parentLocalId}>
                Удалить ветку
              </button>
            </ToolbarGroup>
          </div>

          <div className="task-tree">
            <TaskTreeList
              node={root}
              titleMap={titleMap}
              selectedLocalId={selectedLocalId}
              collapsedIds={collapsedIds}
              onSelect={setSelectedLocalId}
              onToggleCollapse={handleToggleCollapse}
            />
          </div>
        </main>

        <aside className="surface panel details-panel">
          <h2 className="section-title">Детали задачи</h2>
          <TaskDetails
            node={selectedNode}
            directories={directories}
            boards={boards}
            columns={columns}
            addableStickers={addableStickers}
            parentStickerFound={Boolean(parentSticker)}
            parentStickerId={parentSticker?.stickerId}
            stickerDraft={stickerDraft}
            selectedSticker={selectedSticker}
            onChange={updateSelectedNode}
            onStickerDraftChange={setStickerDraft}
            onAddSticker={handleAddSticker}
            onRemoveSticker={handleRemoveSticker}
          />
        </aside>
      </section>

      <section className="surface bottom-panel">
        <div className="preview-panel">
          <h2 className="section-title">Предпросмотр</h2>
          <PreviewNode node={root} titleMap={titleMap} />
        </div>
        <IssueList title="Ошибки" issues={validation.errors} kind="error" />
        <IssueList title="Предупреждения" issues={validation.warnings} kind="warning" />
        <div className="creation-panel">
          <strong>{creationMessage}</strong>
          <span>
            Статус дерева: создано {creationSummary.created}, ошибок {creationSummary.errors}.
          </span>
          <button type="button" onClick={handleCreateTasks} disabled={!validation.isValid}>
            Создать задачи
          </button>
          <button type="button" onClick={handleRetryFailed} disabled={!creationSummary.errors}>
            Повторить неуспешные
          </button>
        </div>
        <CreationResult summary={creationSummary} />
        {createdPayloads.length ? (
          <div className="payload-preview">
            <strong>Payload порядок</strong>
            {createdPayloads.map((item, index) => (
              <pre key={`${item.localId}-${index}`}>{JSON.stringify(item.payload, null, 2)}</pre>
            ))}
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}

function ToolbarGroup(props: {
  title: string;
  description: string;
  items: string[];
  children: ReactNode;
}) {
  return (
    <section className="tree-toolbar-group" aria-label={props.title}>
      <div className="tree-toolbar-group-header">
        <span>{props.title}</span>
        <span className="tree-toolbar-help" tabIndex={0} aria-label={`Подсказка: ${props.title}`}>
          ?
          <span className="tree-toolbar-tooltip" role="tooltip">
            <strong>{props.description}</strong>
            {props.items.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </span>
        </span>
      </div>
      <div className="tree-toolbar-actions">{props.children}</div>
    </section>
  );
}

function CreationResult(props: { summary: TaskTreeCreationSummary }) {
  return (
    <div className="creation-result">
      <strong>
        Создано: {props.summary.created} · Ошибок: {props.summary.errors}
      </strong>
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
    </div>
  );
}

function TaskTreeList(props: {
  node: TaskNode;
  titleMap: Map<string, string>;
  selectedLocalId: string;
  collapsedIds: Set<string>;
  onSelect: (localId: string) => void;
  onToggleCollapse: (localId: string) => void;
}) {
  const isSelected = props.node.localId === props.selectedLocalId;
  const isCollapsed = props.collapsedIds.has(props.node.localId);
  const hasChildren = props.node.children.length > 0;

  return (
    <div className="tree-row-wrap">
      <div className={`tree-row ${isSelected ? 'selected' : ''}`} style={{ paddingLeft: `${props.node.level * 18}px` }}>
        <button
          type="button"
          className="collapse-button"
          onClick={() => props.onToggleCollapse(props.node.localId)}
          disabled={!hasChildren}
        >
          {hasChildren ? (isCollapsed ? '+' : '-') : ''}
        </button>
        <button type="button" className="task-title-button" onClick={() => props.onSelect(props.node.localId)}>
          <span>{props.titleMap.get(props.node.localId) || 'Без названия'}</span>
          <small>
            L{props.node.level} · {props.node.status}
          </small>
        </button>
      </div>
      {!isCollapsed
        ? props.node.children.map((child) => (
            <TaskTreeList
              key={child.localId}
              node={child}
              titleMap={props.titleMap}
              selectedLocalId={props.selectedLocalId}
              collapsedIds={props.collapsedIds}
              onSelect={props.onSelect}
              onToggleCollapse={props.onToggleCollapse}
            />
          ))
        : null}
    </div>
  );
}

function TaskDetails(props: {
  node: TaskNode;
  directories: DirectoriesCache;
  boards: DirectoriesCache['boards'];
  columns: DirectoriesCache['columns'];
  addableStickers: AddableStickerOption[];
  parentStickerFound: boolean;
  parentStickerId?: string;
  stickerDraft: StickerDraft;
  selectedSticker?: AddableStickerOption;
  onChange: (updater: (node: TaskNode) => TaskNode) => void;
  onStickerDraftChange: React.Dispatch<React.SetStateAction<StickerDraft>>;
  onAddSticker: () => void;
  onRemoveSticker: (stickerId: string) => void;
}) {
  const selectedStateSticker = props.selectedSticker?.kind === 'state' ? props.selectedSticker : undefined;
  const projectStickerOption = getProjectStickerOption(props.addableStickers);
  const projectStickerMatch = findProjectStickerMatch(props.addableStickers, props.node.boardTitle);
  const autoProjectStickerEnabled = props.node.autoProjectStickerEnabled ?? true;
  const canAutoProjectSticker = Boolean(projectStickerMatch);
  const projectStickerError = autoProjectStickerEnabled && !canAutoProjectSticker && props.node.boardTitle
    ? 'Название доски не прошло сопоставления со стикером Проект'
    : '';

  return (
    <div className="details-form">
      <label>
        Режим названия
        <select
          value={props.node.titleMode}
          onChange={(event) => props.onChange((node) => ({ ...node, titleMode: event.target.value as TaskTitleMode }))}
        >
          <option value="custom">Ввести самостоятельно</option>
          <option value="copy_parent">Скопировать название родителя</option>
          <option value="copy_parent_and_extend">Скопировать и дополнить</option>
        </select>
      </label>
      {props.node.titleMode === 'custom' ? (
        <label>
          Название
          <input value={props.node.title} onChange={(event) => props.onChange((node) => ({ ...node, title: event.target.value }))} />
        </label>
      ) : null}
      {props.node.titleMode === 'copy_parent_and_extend' ? (
        <label>
          Дополнение
          <input
            value={props.node.titleSuffix ?? ''}
            onChange={(event) => props.onChange((node) => ({ ...node, titleSuffix: event.target.value }))}
          />
        </label>
      ) : null}
      <div className="details-field">
        <span>Описание</span>
        <DescriptionEditor
          value={props.node.description}
          title={props.node.title || 'Описание задачи'}
          onChange={(description) => props.onChange((node) => ({ ...node, description }))}
        />
      </div>
      <div className="details-field">
        Исполнитель
        <SearchableSelect
          value={props.node.executorUserId ?? ''}
          placeholder="Не выбран"
          searchPlaceholder="Поиск исполнителя"
          options={props.directories.users.map((user) => ({
            value: user.id,
            label: getUserDisplayName(user),
          }))}
          onChange={(value) =>
            props.onChange((node) => {
              const user = props.directories.users.find((item) => item.id === value);
              return {
                ...node,
                executorUserId: value || undefined,
                executorName: user ? getUserDisplayName(user) : undefined,
              };
            })
          }
        />
      </div>
      <div className="details-grid">
        <label>
          Дедлайн
          <input
            type="date"
            value={props.node.deadline ?? ''}
            onChange={(event) => props.onChange((node) => ({ ...node, deadline: event.target.value || undefined }))}
          />
        </label>
        <label>
          Старт
          <input
            type="date"
            value={props.node.startDate ?? ''}
            onChange={(event) => props.onChange((node) => ({ ...node, startDate: event.target.value || undefined }))}
          />
        </label>
      </div>
      <div className="details-field">
        Проект
        <SearchableSelect
          value={props.node.projectId ?? ''}
          placeholder="Выберите проект"
          searchPlaceholder="Поиск проекта"
          options={props.directories.projects.map((project) => ({
            value: project.id,
            label: project.title,
          }))}
          onChange={(value) =>
            props.onChange((node) => {
              const project = props.directories.projects.find((item) => item.id === value);
              return {
                ...node,
                projectId: project?.id,
                projectTitle: project?.title,
                boardId: undefined,
                boardTitle: undefined,
                columnId: node.parentLocalId ? undefined : node.columnId,
                columnTitle: node.parentLocalId ? undefined : node.columnTitle,
                stickers: {},
                numericStickers: {},
                children: node.children.map((child) =>
                  applyDirectoryToSubtree(child, {
                    projectId: project?.id,
                    projectTitle: project?.title,
                    boardId: undefined,
                    boardTitle: undefined,
                  }),
                ),
              };
            })
          }
        />
      </div>
      <div className="details-field">
        Доска
        <SearchableSelect
          value={props.node.boardId ?? ''}
          placeholder="Выберите доску"
          searchPlaceholder="Поиск доски"
          disabled={!props.node.projectId}
          options={props.boards.map((board) => ({
            value: board.id,
            label: board.title,
          }))}
          onChange={(value) =>
            props.onChange((node) => {
              const board = props.directories.boards.find((item) => item.id === value);
              const nextAddableStickers = getAddableStickerOptions(
                board?.id ?? '',
                props.directories.stickers,
                props.directories.boardStickerConfig,
              );
              const projectSticker = findProjectStickerMatch(nextAddableStickers, board?.title);
              const directory = {
                projectId: node.projectId,
                projectTitle: node.projectTitle,
                boardId: board?.id,
                boardTitle: board?.title,
              };
              const nextNode = applyProjectStickerToSubtree(
                {
                  ...node,
                  ...directory,
                  autoProjectStickerEnabled: true,
                  columnId: undefined,
                  columnTitle: undefined,
                  stickers: {},
                  numericStickers: {},
                  children: node.children.map((child) => applyDirectoryToSubtree(child, directory)),
                },
                projectSticker,
                getProjectStickerOption(nextAddableStickers)?.id,
              );

              return {
                ...nextNode,
              };
            })
          }
        />
      </div>
      <label className="parent-sticker">
        <input
          type="checkbox"
          checked={Boolean(props.node.includeBoardTitleInTitle)}
          disabled={!props.node.boardTitle}
          onChange={(event) =>
            props.onChange((node) => ({
              ...node,
              includeBoardTitleInTitle: event.target.checked,
              title: event.target.checked ? node.title : removeBoardTitlePrefix(node),
            }))
          }
        />
        Добавлять доску в название
      </label>
      <div className="details-field">
        Колонка
        <SearchableSelect
          value={props.node.columnId ?? ''}
          placeholder="Выберите колонку"
          searchPlaceholder="Поиск колонки"
          disabled={Boolean(props.node.parentLocalId) || !props.node.boardId}
          options={props.columns.map((column) => ({
            value: column.id,
            label: column.title,
          }))}
          onChange={(value) => {
            const column = props.directories.columns.find((item) => item.id === value);
            props.onChange((node) => ({
              ...node,
              columnId: column?.id,
              columnTitle: column?.title,
            }));
          }}
        />
      </div>
      <label className="parent-sticker">
        <input
          type="checkbox"
          checked={Boolean(props.node.isParentFlag)}
          disabled={!props.parentStickerFound}
          onChange={(event) => props.onChange((node) => ({ ...node, isParentFlag: event.target.checked }))}
        />
        Родитель
      </label>
      <label className="parent-sticker auto-project-sticker">
        <input
          type="checkbox"
          checked={autoProjectStickerEnabled && canAutoProjectSticker}
          disabled={!props.node.boardTitle}
          onChange={(event) =>
            props.onChange((node) =>
              applyProjectStickerToSubtree(
                {
                  ...node,
                  autoProjectStickerEnabled: event.target.checked,
                },
                event.target.checked ? projectStickerMatch : undefined,
                projectStickerOption?.id,
              ),
            )
          }
        />
        Проект по доске
        {projectStickerError ? (
          <span className="inline-error-help" tabIndex={0} aria-label={projectStickerError}>
            !
            <span role="tooltip">{projectStickerError}</span>
          </span>
        ) : null}
      </label>
      <div className="sticker-editor">
        <label>
          Стикер
          <select
            value={props.stickerDraft.stickerId}
            onChange={(event) =>
              props.onStickerDraftChange({
                stickerId: event.target.value,
                stateId: '',
                numericValue: '',
              })
            }
          >
            <option value="">Добавить стикер</option>
            {props.addableStickers.filter((sticker) => !isProjectStickerOption(sticker)).map((sticker) => (
              <option key={sticker.id} value={sticker.id}>
                {sticker.name}
              </option>
            ))}
          </select>
        </label>
        {selectedStateSticker ? (
          <div className="details-field">
            Состояние
            <SearchableSelect
              value={props.stickerDraft.stateId}
              placeholder="Выберите состояние"
              searchPlaceholder="Поиск состояния"
              options={(selectedStateSticker.states ?? []).map((state) => ({
                value: state.id,
                label: state.name,
              }))}
              onChange={(value) => props.onStickerDraftChange((current) => ({ ...current, stateId: value }))}
            />
          </div>
        ) : null}
        {props.selectedSticker?.kind === 'numeric' ? (
          <label>
            Значение
            <input
              value={props.stickerDraft.numericValue}
              onChange={(event) =>
                props.onStickerDraftChange((current) => ({ ...current, numericValue: event.target.value }))
              }
            />
          </label>
        ) : null}
        <button type="button" onClick={props.onAddSticker} disabled={!canAddSticker(props.stickerDraft, props.selectedSticker)}>
          Добавить
        </button>
      </div>
      <SelectedStickerList
        node={props.node}
        directories={props.directories}
        stickers={props.addableStickers}
        parentStickerId={props.parentStickerId}
        onRemove={props.onRemoveSticker}
      />
    </div>
  );
}

function SelectedStickerList(props: {
  node: TaskNode;
  directories: DirectoriesCache;
  stickers: AddableStickerOption[];
  parentStickerId?: string;
  onRemove: (stickerId: string) => void;
}) {
  const entries = [...Object.entries(props.node.stickers), ...Object.entries(props.node.numericStickers ?? {})].filter(
    ([stickerId]) => stickerId !== props.parentStickerId,
  );

  if (!entries.length) {
    return <span className="hint-text">Стикеры не выбраны.</span>;
  }

  return (
    <div className="selected-stickers">
      {entries.map(([stickerId, value]) => {
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
          <button type="button" className="searchable-select-option" onMouseDown={(event) => event.preventDefault()} onClick={() => handleSelect('')}>
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

function DescriptionEditor(props: { value: string; title: string; onChange: (value: string) => void }) {
  const compactEditorRef = useRef<HTMLDivElement>(null);
  const fullEditorRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleInput = (element: HTMLDivElement | null) => {
    props.onChange(normalizeEditorHtml(element?.innerHTML ?? ''));
  };

  const runCommand = (command: string, value?: string) => {
    const editor = isFullscreen ? fullEditorRef.current : compactEditorRef.current;

    editor?.focus();
    document.execCommand(command, false, value);
    handleInput(editor);
  };

  useEffect(() => {
    const activeElement = document.activeElement;

    if (activeElement !== compactEditorRef.current) {
      syncEditorHtml(compactEditorRef.current, props.value);
    }

    if (activeElement !== fullEditorRef.current) {
      syncEditorHtml(fullEditorRef.current, props.value);
    }
  }, [props.value, isFullscreen]);

  return (
    <>
      <div className="description-editor">
        <DescriptionToolbar
          onCommand={runCommand}
          onFullscreen={() => setIsFullscreen(true)}
          isFullscreen={false}
        />
        <div
          ref={compactEditorRef}
          className="description-input"
          contentEditable
          role="textbox"
          aria-label="Описание"
          onInput={(event) => handleInput(event.currentTarget)}
          onBlur={(event) => handleInput(event.currentTarget)}
        />
      </div>

      {isFullscreen ? (
        <div className="description-fullscreen">
          <DescriptionToolbar
            onCommand={runCommand}
            onFullscreen={() => setIsFullscreen(false)}
            isFullscreen
          />
          <div className="description-fullscreen-title">{props.title || 'Описание задачи'}</div>
          <div
            ref={fullEditorRef}
            className="description-input description-input-full"
            contentEditable
            role="textbox"
            aria-label="Полное описание"
            onInput={(event) => handleInput(event.currentTarget)}
            onBlur={(event) => handleInput(event.currentTarget)}
          />
        </div>
      ) : null}
    </>
  );
}

function DescriptionToolbar(props: {
  onCommand: (command: string, value?: string) => void;
  onFullscreen: () => void;
  isFullscreen: boolean;
}) {
  return (
    <div className="description-toolbar" aria-label="Форматирование описания">
      <select aria-label="Стиль текста" onChange={(event) => props.onCommand('formatBlock', event.target.value)} defaultValue="div">
        <option value="div">Текст</option>
        <option value="h2">Заголовок</option>
        <option value="h3">Подзаголовок</option>
        <option value="blockquote">Цитата</option>
      </select>
      <button type="button" title="Жирный" onClick={() => props.onCommand('bold')}>
        <strong>B</strong>
      </button>
      <button type="button" title="Курсив" onClick={() => props.onCommand('italic')}>
        <em>I</em>
      </button>
      <button type="button" title="Зачеркнутый" onClick={() => props.onCommand('strikeThrough')}>
        <span className="strike-label">S</span>
      </button>
      <button type="button" title="Подчеркнутый" onClick={() => props.onCommand('underline')}>
        <u>U</u>
      </button>
      <button type="button" title="Маркированный список" onClick={() => props.onCommand('insertUnorderedList')}>
        •
      </button>
      <button type="button" title="Нумерованный список" onClick={() => props.onCommand('insertOrderedList')}>
        1.
      </button>
      <button type="button" title="Ссылка" onClick={() => props.onCommand('createLink', window.prompt('Вставьте ссылку') ?? '')}>
        Link
      </button>
      <button type="button" title="Убрать форматирование" onClick={() => props.onCommand('removeFormat')}>
        Tx
      </button>
      <button type="button" title={props.isFullscreen ? 'Вернуться к форме' : 'Открыть на всю страницу'} onClick={props.onFullscreen}>
        {props.isFullscreen ? 'Mini' : 'Full'}
      </button>
    </div>
  );
}

function PreviewNode(props: { node: TaskNode; titleMap: Map<string, string> }) {
  return (
    <div className="preview-node" style={{ paddingLeft: `${props.node.level * 16}px` }}>
      <span>{props.titleMap.get(props.node.localId) || 'Без названия'}</span>
      {props.node.children.map((child) => (
        <PreviewNode key={child.localId} node={child} titleMap={props.titleMap} />
      ))}
    </div>
  );
}

function IssueList(props: { title: string; issues: TaskTreeValidationIssue[]; kind: 'error' | 'warning' }) {
  if (!props.issues.length) {
    return null;
  }

  return (
    <div className={`issue-list ${props.kind}`}>
      <strong>{props.title}</strong>
      {props.issues.map((issue, index) => (
        <span key={`${issue.code}-${issue.localId ?? 'root'}-${index}`}>{issue.message}</span>
      ))}
    </div>
  );
}

function syncEditorHtml(element: HTMLDivElement | null, value: string): void {
  if (!element || element.innerHTML === value) {
    return;
  }

  element.innerHTML = value;
}

function normalizeEditorHtml(value: string): string {
  const trimmed = value.trim();

  return trimmed === '<br>' ? '' : trimmed;
}

function getBackgroundDebugMessage(result: CreateYouGileTaskTreeResult): string {
  const deadlineUpdates = result.createdTasks.filter((item) => item.deadlineUpdate?.requested);
  const deadlineMessage = deadlineUpdates.length
    ? `Дедлайн PUT: ${deadlineUpdates.filter((item) => item.deadlineUpdate?.ok).length}/${deadlineUpdates.length}.`
    : 'Дедлайн PUT: 0.';
  const versionMessage = result.debug?.serviceWorkerVersion
    ? `SW: ${result.debug.serviceWorkerVersion}.`
    : 'SW: старая версия без диагностики.';

  return `${deadlineMessage} ${versionMessage}`;
}

function createBlankRoot(defaults: Partial<TaskNode> = {}): TaskNode {
  return {
    localId: 'root',
    parentLocalId: null,
    level: 0,
    order: 0,
    titleMode: 'custom',
    title: '',
    description: '',
    stickers: {},
    numericStickers: {},
    autoProjectStickerEnabled: true,
    children: [],
    status: 'draft',
    ...defaults,
  };
}

function createBlankNode(input: {
  parent: TaskNode;
  localId: string;
  order: number;
  title?: string;
}): TaskNode {
  return {
    localId: input.localId,
    parentLocalId: input.parent.localId,
    level: input.parent.level + 1,
    order: input.order,
    titleMode: 'custom',
    title: input.title ?? '',
    description: '',
    projectId: input.parent.projectId,
    projectTitle: input.parent.projectTitle,
    boardId: input.parent.boardId,
    boardTitle: input.parent.boardTitle,
    stickers: {},
    numericStickers: {},
    autoProjectStickerEnabled: input.parent.autoProjectStickerEnabled ?? true,
    children: [],
    status: 'draft',
  };
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

function updateNode(root: TaskNode, localId: string, updater: (node: TaskNode) => TaskNode): TaskNode {
  if (root.localId === localId) {
    return normalizeTree(updater(cloneNode(root)));
  }

  return normalizeTree({
    ...root,
    children: root.children.map((child) => updateNode(child, localId, updater)),
  });
}

function findNode(root: TaskNode, localId: string): TaskNode | undefined {
  if (root.localId === localId) {
    return root;
  }

  for (const child of root.children) {
    const match = findNode(child, localId);
    if (match) {
      return match;
    }
  }

  return undefined;
}

function deleteNode(root: TaskNode, localId: string, withBranch: boolean): TaskNode {
  return normalizeTree({
    ...root,
    children: root.children.flatMap((child) => {
      if (child.localId !== localId) {
        return [deleteNode(child, localId, withBranch)];
      }

      return withBranch ? [] : child.children.map((grandchild) => ({ ...grandchild, parentLocalId: root.localId }));
    }),
  });
}

function indentNode(root: TaskNode, localId: string): TaskNode {
  const parent = findParent(root, localId);
  if (!parent) {
    return root;
  }

  const index = parent.children.findIndex((child) => child.localId === localId);
  const previousSibling = parent.children[index - 1];
  const node = parent.children[index];

  if (!previousSibling || !node) {
    return root;
  }

  return updateNode(root, parent.localId, (currentParent) => {
    const currentIndex = currentParent.children.findIndex((child) => child.localId === localId);
    const movedNode = currentParent.children[currentIndex];
    const targetSibling = currentParent.children[currentIndex - 1];
    const remaining = currentParent.children.filter((child) => child.localId !== localId);

    return {
      ...currentParent,
      children: normalizeSiblingOrder(
        remaining.map((child) =>
          child.localId === targetSibling.localId
            ? {
                ...child,
                children: normalizeSiblingOrder([
                  ...child.children,
                  { ...movedNode, parentLocalId: child.localId, level: child.level + 1 },
                ]),
              }
            : child,
        ),
      ),
    };
  });
}

function outdentNode(root: TaskNode, localId: string): TaskNode {
  const parent = findParent(root, localId);
  const grandParent = parent?.parentLocalId ? findNode(root, parent.parentLocalId) : undefined;

  if (!parent || !grandParent) {
    return root;
  }

  const node = parent.children.find((child) => child.localId === localId);
  if (!node) {
    return root;
  }

  const withoutNode = updateNode(root, parent.localId, (currentParent) => ({
    ...currentParent,
    children: currentParent.children.filter((child) => child.localId !== localId),
  }));

  return updateNode(withoutNode, grandParent.localId, (currentGrandParent) => {
    const parentIndex = currentGrandParent.children.findIndex((child) => child.localId === parent.localId);
    const nextChildren = [...currentGrandParent.children];
    nextChildren.splice(parentIndex + 1, 0, {
      ...node,
      parentLocalId: currentGrandParent.localId,
      level: currentGrandParent.level + 1,
    });

    return {
      ...currentGrandParent,
      children: normalizeSiblingOrder(nextChildren),
    };
  });
}

function findParent(root: TaskNode, localId: string): TaskNode | undefined {
  if (root.children.some((child) => child.localId === localId)) {
    return root;
  }

  for (const child of root.children) {
    const match = findParent(child, localId);
    if (match) {
      return match;
    }
  }

  return undefined;
}

function moveChild(children: TaskNode[], localId: string, direction: 'up' | 'down'): TaskNode[] {
  const index = children.findIndex((child) => child.localId === localId);
  const nextIndex = direction === 'up' ? index - 1 : index + 1;

  if (index < 0 || nextIndex < 0 || nextIndex >= children.length) {
    return children;
  }

  const nextChildren = [...children];
  const [item] = nextChildren.splice(index, 1);
  nextChildren.splice(nextIndex, 0, item);
  return normalizeSiblingOrder(nextChildren);
}

function duplicateNode(node: TaskNode, parentLocalId: string | null, withBranch: boolean): TaskNode {
  const nextLocalId = makeLocalId();
  const children = withBranch
    ? node.children.map((child, index) => duplicateNode(child, nextLocalId, true)).map((child, index) => ({ ...child, order: index }))
    : [];

  return {
    ...cloneNode(node),
    localId: nextLocalId,
    parentLocalId,
    title: node.title ? `${node.title} копия` : '',
    children,
    yougileTaskId: undefined,
    status: 'draft',
    error: undefined,
  };
}

function normalizeTree(root: TaskNode): TaskNode {
  function visit(
    node: TaskNode,
    parentLocalId: string | null,
    level: number,
    order: number,
    inheritedDirectory?: Pick<TaskNode, 'projectId' | 'projectTitle' | 'boardId' | 'boardTitle'>,
  ): TaskNode {
    const nextNode = {
      ...node,
      projectId: node.projectId || inheritedDirectory?.projectId,
      projectTitle: node.projectTitle || inheritedDirectory?.projectTitle,
      boardId: node.boardId || inheritedDirectory?.boardId,
      boardTitle: node.boardTitle || inheritedDirectory?.boardTitle,
    };

    return {
      ...nextNode,
      parentLocalId,
      level,
      order,
      children: nextNode.children.map((child, index) =>
        visit(child, nextNode.localId, level + 1, index, {
          projectId: nextNode.projectId,
          projectTitle: nextNode.projectTitle,
          boardId: nextNode.boardId,
          boardTitle: nextNode.boardTitle,
        }),
      ),
    };
  }

  return visit(root, null, 0, 0);
}

function applyDirectoryToSubtree(
  node: TaskNode,
  directory: Pick<TaskNode, 'projectId' | 'projectTitle' | 'boardId' | 'boardTitle'>,
): TaskNode {
  return {
    ...node,
    ...directory,
    columnId: undefined,
    columnTitle: undefined,
    stickers: {},
    numericStickers: {},
    autoProjectStickerEnabled: node.autoProjectStickerEnabled ?? true,
    children: node.children.map((child) => applyDirectoryToSubtree(child, directory)),
  };
}

function normalizeSiblingOrder(children: TaskNode[]): TaskNode[] {
  return children.map((child, index) => ({ ...child, order: index }));
}

function cloneNode(node: TaskNode): TaskNode {
  return {
    ...node,
    stickers: { ...node.stickers },
    numericStickers: { ...(node.numericStickers ?? {}) },
    children: node.children.map(cloneNode),
  };
}

function applyDefaultDirectories(root: TaskNode, directories: DirectoriesCache): TaskNode {
  const firstProject = directories.projects[0];
  const firstBoard = firstProject ? filterBoardsByProject(directories.boards, firstProject.id)[0] : undefined;
  const firstColumn = firstBoard ? filterColumnsByBoard(directories.columns, firstBoard.id)[0] : undefined;

  return updateNode(root, root.localId, (node) => ({
    ...node,
    projectId: node.projectId || firstProject?.id,
    projectTitle: node.projectTitle || firstProject?.title,
    boardId: node.boardId || firstBoard?.id,
    boardTitle: node.boardTitle || firstBoard?.title,
    columnId: node.columnId || firstColumn?.id,
    columnTitle: node.columnTitle || firstColumn?.title,
  }));
}

function getRootDirectoryDefaults(root: TaskNode): Partial<TaskNode> {
  return {
    projectId: root.projectId,
    projectTitle: root.projectTitle,
    boardId: root.boardId,
    boardTitle: root.boardTitle,
    columnId: root.columnId,
    columnTitle: root.columnTitle,
  };
}

function getProjectStickerId(directories: DirectoriesCache): string | undefined {
  return directories.stickers.find((sticker) => normalizeStickerMatchText(sticker.name) === 'проект')?.id;
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

function applyProjectStickerToSubtree(
  node: TaskNode,
  projectSticker?: ProjectStickerMatch,
  projectStickerId?: string,
): TaskNode {
  const stickerIdToRemove = projectSticker?.stickerId ?? projectStickerId;
  const stickersWithoutProject = stickerIdToRemove ? removeRecordKey(node.stickers, stickerIdToRemove) : node.stickers;
  const stickers = projectSticker
    ? {
        ...stickersWithoutProject,
        [projectSticker.stickerId]: projectSticker.stateId,
      }
    : stickersWithoutProject;

  return {
    ...node,
    stickers,
    children: node.children.map((child) => applyProjectStickerToSubtree(child, projectSticker, stickerIdToRemove)),
  };
}

function removeRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
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

function addStickerToNode(node: TaskNode, option: AddableStickerOption, draft: StickerDraft): TaskNode {
  if (option.kind === 'numeric') {
    return {
      ...node,
      numericStickers: {
        ...(node.numericStickers ?? {}),
        [option.id]: draft.numericValue.replace(',', '.'),
      },
    };
  }

  return {
    ...node,
    stickers: {
      ...node.stickers,
      [option.id]: draft.stateId,
    },
  };
}

function removeStickerFromNode(node: TaskNode, stickerId: string): TaskNode {
  const { [stickerId]: _state, ...stickers } = node.stickers;
  const { [stickerId]: _numeric, ...numericStickers } = node.numericStickers ?? {};

  return {
    ...node,
    stickers,
    numericStickers,
  };
}

function applyParentSticker(root: TaskNode, parentSticker: { stickerId: string; stateId: string }): TaskNode {
  function visit(node: TaskNode): TaskNode {
    return {
      ...cloneNode(node),
      stickers: {
        ...node.stickers,
        ...(node.isParentFlag ? { [parentSticker.stickerId]: parentSticker.stateId } : {}),
      },
      children: node.children.map(visit),
    };
  }

  return visit(root);
}

function mergeCreationState(editableRoot: TaskNode, creationRoot: TaskNode): TaskNode {
  const creationByLocalId = new Map(flattenTaskTree(creationRoot).map((node) => [node.localId, node]));

  function visit(node: TaskNode): TaskNode {
    const creationNode = creationByLocalId.get(node.localId);

    return {
      ...cloneNode(node),
      status: creationNode?.status ?? node.status,
      yougileTaskId: creationNode?.yougileTaskId,
      error: creationNode?.error,
      children: node.children.map(visit),
    };
  }

  return normalizeTree(visit(editableRoot));
}

function prepareTemplateRoot(
  root: TaskNode,
  includeProjectTraits = true,
  projectStickerId?: string,
): TaskNode {
  return prepareTaskTreeTemplateRoot(root, {
    includeProjectTraits,
    projectStickerId,
  });
}

function prepareFreshCreationRoot(root: TaskNode): TaskNode {
  return normalizeTree(resetCreationState(cloneNode(root), null));
}

function materializeTitlesForCreation(root: TaskNode): TaskNode {
  const titleByLocalId = buildTitleMap(root);

  function visit(node: TaskNode): TaskNode {
    return {
      ...cloneNode(node),
      titleMode: 'custom',
      title: titleByLocalId.get(node.localId) ?? node.title,
      titleSuffix: undefined,
      includeBoardTitleInTitle: false,
      children: node.children.map(visit),
    };
  }

  return normalizeTree(visit(root));
}

async function collectTaskPayloadsForPreview(
  root: TaskNode,
  validationContext: TaskTreeValidationContext,
): Promise<Array<{ localId: string; payload: CreateTaskPayload }>> {
  const draftRoot = cloneNode(root);
  const creationOrder = flattenTaskTree(draftRoot)
    .slice()
    .sort((a, b) => b.level - a.level || a.order - b.order)
    .map((node) => node.localId);
  const payloads: Array<{ localId: string; payload: CreateTaskPayload }> = [];
  let counter = 1;

  await createTaskTree(
    draftRoot,
    async (payload) => {
      payloads.push({ localId: creationOrder[payloads.length] ?? draftRoot.localId, payload });

      return {
        id: `preview-task-${counter++}`,
        title: payload.title,
      };
    },
    validationContext,
  );

  return payloads;
}

function instantiateTemplateRoot(root: TaskNode, rootDefaults: Partial<TaskNode> = {}): TaskNode {
  function rekey(node: TaskNode, parentLocalId: string | null): TaskNode {
    const nextLocalId = parentLocalId === null ? 'root' : makeLocalId();

    return {
      ...resetNodeCreationState(node),
      localId: nextLocalId,
      parentLocalId,
      children: node.children.map((child) => rekey(child, nextLocalId)),
    };
  }

  return normalizeTree({
    ...rekey(root, null),
    ...rootDefaults,
  });
}

function resetCreationState(node: TaskNode, parentLocalId: string | null): TaskNode {
  return {
    ...resetNodeCreationState(node),
    parentLocalId,
    children: node.children.map((child) => resetCreationState(child, node.localId)),
  };
}

function resetNodeCreationState(node: TaskNode): TaskNode {
  return {
    ...node,
    stickers: { ...node.stickers },
    numericStickers: { ...(node.numericStickers ?? {}) },
    yougileTaskId: undefined,
    status: 'draft',
    error: undefined,
  };
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

function removeBoardTitlePrefix(node: TaskNode): string {
  const boardTitle = node.boardTitle?.trim();
  const title = node.title.trim();

  if (!boardTitle) {
    return node.title;
  }

  if (title === boardTitle) {
    return '';
  }

  if (title.startsWith(`${boardTitle} / `)) {
    return title.slice(`${boardTitle} / `.length);
  }

  return node.title;
}

function makeLocalId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeTemplateId(): string {
  return `template-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function readTemplateImportFile(file: File, directories: DirectoriesCache): Promise<TemplateImportResult> {
  const text = await file.text();

  try {
    return parseTemplatesImportDocument(JSON.parse(text), directories);
  } catch (error) {
    throw new Error(`${file.name}: ${getErrorMessage(error)}`);
  }
}

function downloadJsonFile(fileName: string, data: unknown): void {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function sanitizeFileName(value: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLocaleLowerCase('ru-RU');

  return normalized || 'template';
}

function formatDateFilePart(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function isExtensionRuntimeAvailable(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.sendMessage);
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
