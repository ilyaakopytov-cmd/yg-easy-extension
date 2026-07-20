import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { BackgroundResponse } from '../background/messages';
import { sendBackgroundMessage } from '../background/messages';
import { AppShell } from '../shared/AppShell';
import {
  EMPTY_DIRECTORIES_CACHE,
  readDirectoriesCache,
  type DirectoriesCache,
} from '../storage/directoriesStorage';
import {
  DEFAULT_EXTENSION_SETTINGS,
  readSettings,
  writeApiKey,
  writeSettings,
  type ApiKeyStorageMode,
  type ExtensionSettings,
  type SavedTokenSummary,
  type TokenListRequestSettings,
  type TokenRequestSettings,
} from '../storage/settingsStorage';
import { readTemplates, writeTemplates, type TaskTreeTemplate } from '../storage/templatesStorage';
import { buildTemplatesExport } from '../templates/templateExport';
import { parseTemplatesImportDocument, type TemplateImportResult } from '../templates/templateImport';
import './options.css';

type ConnectionCheckResult = {
  projectCount: number;
  maskedApiKey: string;
  storageMode: ApiKeyStorageMode;
};

type RequestApiKeyResult = {
  token: SavedTokenSummary;
  savedLocally: boolean;
};

type LoadApiKeysResult = {
  tokens: SavedTokenSummary[];
};

type DeleteApiKeyResult = {
  deleted: true;
};

type OptionsSection = 'ready-token' | 'token-management' | 'templates';

const OPTIONS_SECTIONS: Array<{ id: OptionsSection; title: string }> = [
  { id: 'ready-token', title: 'Вставить готовый токен' },
  { id: 'token-management', title: 'Запрос и отслеживание токенов' },
  { id: 'templates', title: 'Шаблоны' },
];

export function OptionsApp() {
  const [activeSection, setActiveSection] = useState<OptionsSection>('ready-token');
  const [apiKey, setApiKey] = useState('');
  const [storageMode, setStorageMode] = useState<ApiKeyStorageMode>('session');
  const [rememberApiKey, setRememberApiKey] = useState(false);
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_EXTENSION_SETTINGS);
  const [tokenMode, setTokenMode] = useState<'request' | 'list'>('request');
  const [tokenRequest, setTokenRequest] = useState<TokenRequestSettings>(DEFAULT_EXTENSION_SETTINGS.tokenSettings.request);
  const [tokenListRequest, setTokenListRequest] = useState<TokenListRequestSettings>(DEFAULT_EXTENSION_SETTINGS.tokenSettings.list);
  const [savedTokens, setSavedTokens] = useState<SavedTokenSummary[]>([]);
  const [directories, setDirectories] = useState<DirectoriesCache>(EMPTY_DIRECTORIES_CACHE);
  const [templates, setTemplates] = useState<TaskTreeTemplate[]>([]);
  const [status, setStatus] = useState('Подключение ещё не проверялось.');
  const [tokenStatus, setTokenStatus] = useState('Запрос токена ещё не выполнялся.');
  const [templateStatus, setTemplateStatus] = useState('Шаблоны пока не загружены.');
  const [isChecking, setIsChecking] = useState(false);
  const templateImportInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function restoreSettings() {
      const storedSettings = await readSettings();
      const storedDirectories = await readDirectoriesCache();
      const storedTemplates = await readTemplates();

      if (!isMounted) {
        return;
      }

      setSettings(storedSettings);
      setStorageMode(storedSettings.apiKeyStorageMode);
      setRememberApiKey(storedSettings.rememberApiKey);
      setTokenRequest(storedSettings.tokenSettings.request);
      setTokenListRequest(storedSettings.tokenSettings.list);
      setSavedTokens(storedSettings.tokenSettings.savedTokens);
      setDirectories(storedDirectories);
      setTemplates(storedTemplates);
      setTemplateStatus(
        storedTemplates.length
          ? `Загружено шаблонов: ${storedTemplates.length}.`
          : 'Сохранённых шаблонов пока нет.',
      );
    }

    void restoreSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleCheckConnection = async () => {
    setIsChecking(true);
    setStatus('Проверяем подключение...');

    const response: BackgroundResponse<ConnectionCheckResult> = await sendBackgroundMessage({
      type: 'YG_EASY_CHECK_CONNECTION',
      apiKey,
      storageMode,
      rememberApiKey,
    });

    setIsChecking(false);

    if (!response.ok) {
      setStatus(`Ошибка подключения: ${response.error}`);
      return;
    }

    setSettings({
      ...settings,
      apiKeyStorageMode: response.data.storageMode,
      rememberApiKey,
      maskedApiKey: response.data.maskedApiKey,
    });
    setStatus(`Подключение успешно. Проектов получено: ${response.data.projectCount}.`);
  };

  const persistTokenSettings = async (next: ExtensionSettings['tokenSettings'], message: string) => {
    const nextSettings: ExtensionSettings = {
      ...settings,
      tokenSettings: next,
    };

    await writeSettings(nextSettings);
    setSettings(nextSettings);
    setTokenStatus(message);
  };

  const handleSaveTokenRequestData = async (request: TokenRequestSettings = tokenRequest) => {
    const nextRequest = request.rememberRequestData
      ? request
      : {
          ...DEFAULT_EXTENSION_SETTINGS.tokenSettings.request,
          autoSaveRequestedToken: request.autoSaveRequestedToken,
          rememberRequestData: false,
        };

    setTokenRequest(nextRequest);
    await persistTokenSettings(
      {
        ...settings.tokenSettings,
        request: nextRequest,
        savedTokens,
      },
      request.rememberRequestData ? 'Данные запроса токена сохранены локально.' : 'Локально сохранённые данные запроса очищены.',
    );
  };

  const handleSaveTokenListRequestData = async (listRequest: TokenListRequestSettings = tokenListRequest) => {
    const nextListRequest = listRequest.rememberListRequestData
      ? listRequest
      : DEFAULT_EXTENSION_SETTINGS.tokenSettings.list;

    setTokenListRequest(nextListRequest);
    await persistTokenSettings(
      {
        ...settings.tokenSettings,
        list: nextListRequest,
        savedTokens,
      },
      listRequest.rememberListRequestData
        ? 'Данные просмотра токенов сохранены локально.'
        : 'Локально сохранённые данные просмотра токенов очищены.',
    );
  };

  const handleTokenRequestToggle = async (rememberRequestData: boolean) => {
    const nextRequest = {
      ...tokenRequest,
      rememberRequestData,
    };
    setTokenRequest(nextRequest);
    await handleSaveTokenRequestData(nextRequest);
  };

  const handleTokenListToggle = async (rememberListRequestData: boolean) => {
    const nextListRequest = {
      ...tokenListRequest,
      rememberListRequestData,
    };
    setTokenListRequest(nextListRequest);
    await handleSaveTokenListRequestData(nextListRequest);
  };

  const handleRequestToken = async () => {
    setTokenStatus('Запрашиваем токен YouGile...');

    const response: BackgroundResponse<RequestApiKeyResult> = await sendBackgroundMessage({
      type: 'YG_EASY_REQUEST_API_KEY',
      login: tokenRequest.login,
      password: tokenRequest.password,
      companyId: tokenRequest.companyId,
      autoSaveRequestedToken: tokenRequest.autoSaveRequestedToken,
    });

    if (!response.ok) {
      setTokenStatus(`Ошибка запроса токена: ${response.error}`);
      return;
    }

    const nextSavedTokens = upsertSavedToken(savedTokens, response.data.token);
    setSavedTokens(nextSavedTokens);

    const nextSettings: ExtensionSettings = {
      ...settings,
      apiKeyStorageMode: response.data.savedLocally ? 'local' : settings.apiKeyStorageMode,
      rememberApiKey: response.data.savedLocally ? true : settings.rememberApiKey,
      maskedApiKey: response.data.savedLocally ? response.data.token.maskedToken : settings.maskedApiKey,
      tokenSettings: {
        ...settings.tokenSettings,
        request: tokenRequest.rememberRequestData
          ? tokenRequest
          : {
              ...DEFAULT_EXTENSION_SETTINGS.tokenSettings.request,
              autoSaveRequestedToken: tokenRequest.autoSaveRequestedToken,
              rememberRequestData: false,
            },
        savedTokens: nextSavedTokens,
      },
    };

    await writeSettings(nextSettings);
    setSettings(nextSettings);
    setTokenStatus(
      response.data.savedLocally
        ? 'Токен получен и сохранён локально как API-ключ расширения.'
        : 'Токен получен. В UI сохранена только маска токена.',
    );
  };

  const handleLoadTokens = async () => {
    setTokenStatus('Загружаем список токенов YouGile...');

    const response: BackgroundResponse<LoadApiKeysResult> = await sendBackgroundMessage({
      type: 'YG_EASY_LOAD_API_KEYS',
      login: tokenListRequest.login,
      password: tokenListRequest.password,
      companyId: tokenListRequest.companyId,
    });

    if (!response.ok) {
      setTokenStatus(`Ошибка загрузки списка токенов: ${response.error}`);
      return;
    }

    setSavedTokens(response.data.tokens);
    await persistTokenSettings(
      {
        ...settings.tokenSettings,
        list: tokenListRequest.rememberListRequestData
          ? tokenListRequest
          : DEFAULT_EXTENSION_SETTINGS.tokenSettings.list,
        savedTokens: response.data.tokens,
      },
      `Список токенов загружен: ${response.data.tokens.length}.`,
    );
  };

  const handleDeleteSavedToken = async (token: SavedTokenSummary) => {
    const tokenValue = token.visibleToken?.trim();

    if (!tokenValue || tokenValue === 'Токен не передан API') {
      setTokenStatus('Нельзя удалить токен: YouGile не передал его значение.');
      return;
    }

    setTokenStatus(`Удаляем токен "${token.name}" в YouGile...`);

    const response: BackgroundResponse<DeleteApiKeyResult> = await sendBackgroundMessage({
      type: 'YG_EASY_DELETE_API_KEY',
      apiKey: tokenValue,
    });

    if (!response.ok) {
      setTokenStatus(`Ошибка удаления токена: ${response.error}`);
      return;
    }

    const nextSavedTokens = savedTokens.filter((item) => item.id !== token.id);
    setSavedTokens(nextSavedTokens);
    await persistTokenSettings(
      {
        ...settings.tokenSettings,
        savedTokens: nextSavedTokens,
      },
      'Токен удалён в YouGile и из локального списка.',
    );
  };

  const handleApplySavedToken = async (token: SavedTokenSummary) => {
    const tokenValue = token.visibleToken?.trim();

    if (!tokenValue || tokenValue === 'Токен не передан API') {
      setTokenStatus('Нельзя применить токен: YouGile не передал его значение.');
      return;
    }

    const nextSettings: ExtensionSettings = {
      ...settings,
      apiKeyStorageMode: 'local',
      rememberApiKey: true,
      maskedApiKey: token.maskedToken,
      tokenSettings: {
        ...settings.tokenSettings,
        savedTokens,
      },
    };

    await writeApiKey(tokenValue, 'local');
    await writeSettings(nextSettings);
    setSettings(nextSettings);
    setStorageMode('local');
    setRememberApiKey(true);
    setTokenStatus(`Токен "${token.name}" применён и сохранён локально как API-ключ расширения.`);
  };

  const handleExportTemplates = () => {
    if (!templates.length) {
      setTemplateStatus('Нет шаблонов для экспорта.');
      return;
    }

    downloadJsonFile(`yg-easy-templates-${formatDateFilePart(new Date())}.json`, buildTemplatesExport(templates, directories));
    setTemplateStatus(`Экспортировано шаблонов: ${templates.length}.`);
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
        setTemplateStatus('В выбранных файлах не найдено шаблонов.');
        return;
      }

      const nextTemplates = [...importedTemplates, ...templates];
      await writeTemplates(nextTemplates);
      setTemplates(nextTemplates);
      setTemplateStatus(
        warnings.length || unresolvedCount
          ? `Импортировано шаблонов: ${importedTemplates.length}. Не сопоставлено: ${unresolvedCount}. ${warnings.slice(0, 2).join(' ')}`
          : `Импортировано шаблонов: ${importedTemplates.length}.`,
      );
    } catch (error) {
      setTemplateStatus(`Ошибка импорта шаблонов: ${getErrorMessage(error)}`);
    }
  };

  return (
    <AppShell
      title="Настройки"
      subtitle="Здесь будет подключение к YouGile, режим хранения API-ключа и синхронизация справочников."
    >
      <div className="options-layout">
        <nav className="surface options-sidebar" aria-label="Разделы настроек">
          {OPTIONS_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className={activeSection === section.id ? 'active' : ''}
              onClick={() => setActiveSection(section.id)}
            >
              {section.title}
            </button>
          ))}
        </nav>

        <main className="surface options-panel">
          {activeSection === 'ready-token' ? (
            <>
              <h2>Вставить готовый токен</h2>
              <label>
                API-ключ YouGile
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={settings.maskedApiKey || 'Будет храниться через chrome.storage'}
                />
              </label>
              <fieldset>
                <legend>Хранение ключа</legend>
                <label className="choice-row">
                  <input
                    type="radio"
                    name="storageMode"
                    checked={storageMode === 'session'}
                    onChange={() => {
                      setStorageMode('session');
                      setRememberApiKey(false);
                    }}
                  />
                  Только до закрытия браузера
                </label>
                <label className="choice-row">
                  <input
                    type="radio"
                    name="storageMode"
                    checked={storageMode === 'local'}
                    onChange={() => {
                      setStorageMode('local');
                      setRememberApiKey(true);
                    }}
                  />
                  Запомнить API-ключ локально
                </label>
              </fieldset>
              {storageMode === 'local' ? (
                <p className="warning">
                  API-ключ будет сохранён локально в браузере. Не используйте этот режим на чужих или
                  общедоступных устройствах.
                </p>
              ) : null}
              <button type="button" onClick={handleCheckConnection} disabled={isChecking}>
                {isChecking ? 'Проверяем...' : 'Проверить подключение'}
              </button>
              <p className="connection-status">{status}</p>
              {settings.maskedApiKey ? <p className="masked-key">Сохранённый ключ: {settings.maskedApiKey}</p> : null}
            </>
          ) : null}

          {activeSection === 'token-management' ? (
            <>
              <h2>Запрос и отслеживание токенов</h2>
              <div className="token-switch" role="tablist" aria-label="Режим токенов">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tokenMode === 'request'}
                  className={tokenMode === 'request' ? 'active' : ''}
                  onClick={() => setTokenMode('request')}
                >
                  Запрос токена
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tokenMode === 'list'}
                  className={tokenMode === 'list' ? 'active' : ''}
                  onClick={() => setTokenMode('list')}
                >
                  Созданные токены
                </button>
              </div>

              {tokenMode === 'request' ? (
                <div className="token-panel">
                  <div className="details-grid">
                    <label>
                      ID компании
                      <input
                        value={tokenRequest.companyId}
                        onChange={(event) => setTokenRequest((current) => ({ ...current, companyId: event.target.value }))}
                        placeholder="companyId"
                      />
                    </label>
                    <label>
                      Логин или e-mail
                      <input
                        value={tokenRequest.login}
                        onChange={(event) => setTokenRequest((current) => ({ ...current, login: event.target.value }))}
                        placeholder="user@example.com"
                      />
                    </label>
                  </div>
                  <label>
                    Пароль
                    <input
                      type="password"
                      value={tokenRequest.password}
                      onChange={(event) => setTokenRequest((current) => ({ ...current, password: event.target.value }))}
                      placeholder="Пароль YouGile"
                    />
                  </label>
                  <label className="choice-row">
                    <input
                      type="checkbox"
                      checked={tokenRequest.autoSaveRequestedToken}
                      onChange={(event) =>
                        setTokenRequest((current) => ({ ...current, autoSaveRequestedToken: event.target.checked }))
                      }
                    />
                    Автоматически сохранить токен локально после запроса
                  </label>
                  <label className="choice-row">
                    <input
                      type="checkbox"
                      checked={tokenRequest.rememberRequestData}
                      onChange={(event) => void handleTokenRequestToggle(event.target.checked)}
                    />
                    Сохранять данные запроса локально
                  </label>
                  {tokenRequest.rememberRequestData ? (
                    <p className="warning">Данные запроса будут сохранены локально в браузере.</p>
                  ) : null}
                  <div className="action-row">
                    <button type="button" onClick={() => void handleSaveTokenRequestData()}>
                      Сохранить данные
                    </button>
                    <button type="button" onClick={handleRequestToken}>
                      Запросить токен
                    </button>
                  </div>
                </div>
              ) : (
                <div className="token-panel">
                  <div className="details-grid">
                    <label>
                      ID компании
                      <input
                        value={tokenListRequest.companyId}
                        onChange={(event) => setTokenListRequest((current) => ({ ...current, companyId: event.target.value }))}
                        placeholder="companyId"
                      />
                    </label>
                    <label>
                      Логин или e-mail
                      <input
                        value={tokenListRequest.login}
                        onChange={(event) => setTokenListRequest((current) => ({ ...current, login: event.target.value }))}
                        placeholder="user@example.com"
                      />
                    </label>
                  </div>
                  <label>
                    Пароль
                    <input
                      type="password"
                      value={tokenListRequest.password}
                      onChange={(event) => setTokenListRequest((current) => ({ ...current, password: event.target.value }))}
                      placeholder="Пароль YouGile"
                    />
                  </label>
                  <label className="choice-row">
                    <input
                      type="checkbox"
                      checked={tokenListRequest.rememberListRequestData}
                      onChange={(event) => void handleTokenListToggle(event.target.checked)}
                    />
                    Сохранять данные просмотра локально
                  </label>
                  <div className="action-row">
                    <button type="button" onClick={() => void handleSaveTokenListRequestData()}>
                      Сохранить данные
                    </button>
                    <button type="button" onClick={handleLoadTokens}>
                      Загрузить список токенов
                    </button>
                  </div>
                  <div className="token-list">
                    {savedTokens.length ? (
                      savedTokens.map((token) => (
                        <div key={token.id} className="token-list-item">
                          <span>
                            <strong>{token.name}</strong>
                            {token.visibleToken || token.maskedToken}
                          </span>
                          <div className="token-list-actions">
                            <button type="button" onClick={() => void handleApplySavedToken(token)}>
                              Применить
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => void handleDeleteSavedToken(token)}
                            >
                              Удалить
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="section-note">Созданные токены пока не загружались.</p>
                    )}
                  </div>
                </div>
              )}
              <p className="connection-status">{tokenStatus}</p>
            </>
          ) : null}

          {activeSection === 'templates' ? (
            <>
              <h2>Шаблоны</h2>
              <p className="section-note">
                Импорт принимает один или несколько JSON-файлов. Экспорт выгружает все сохранённые шаблоны одним
                читаемым JSON-файлом.
              </p>
              <div className="action-row">
                <input
                  ref={templateImportInputRef}
                  className="visually-hidden"
                  type="file"
                  accept="application/json,.json"
                  multiple
                  onChange={handleImportTemplateFiles}
                />
                <button type="button" onClick={handleImportTemplatesClick}>
                  Импорт шаблонов
                </button>
                <button type="button" onClick={handleExportTemplates} disabled={!templates.length}>
                  Экспорт шаблонов
                </button>
              </div>
              <div className="template-summary">
                <span>Сохранено шаблонов: {templates.length}</span>
                <span>Проекты в справочнике: {directories.projects.length}</span>
                <span>Доски в справочнике: {directories.boards.length}</span>
              </div>
              <p className="connection-status">{templateStatus}</p>
            </>
          ) : null}
        </main>
      </div>
    </AppShell>
  );
}

function upsertSavedToken(tokens: SavedTokenSummary[], token: SavedTokenSummary): SavedTokenSummary[] {
  const existingIndex = tokens.findIndex((item) => item.id === token.id);

  if (existingIndex === -1) {
    return [token, ...tokens];
  }

  return tokens.map((item, index) => (index === existingIndex ? token : item));
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

function formatDateFilePart(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message?: unknown }).message);
  }

  return 'Неизвестная ошибка.';
}
