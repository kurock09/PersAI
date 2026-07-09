type ChromeListener<T extends (...args: never[]) => unknown> = {
  addListener(listener: T): void;
  removeListener(listener: T): void;
};

interface ChromeRuntimePort {
  name: string;
  postMessage(message: unknown): void;
  onDisconnect: ChromeListener<() => void>;
  onMessage: ChromeListener<(message: unknown) => void>;
}

interface ChromeTab {
  id?: number;
  status?: string;
  url?: string;
}

interface ChromeWindow {
  id?: number;
  tabs?: ChromeTab[];
}

interface ChromeMessageSender {
  url?: string;
}

interface ChromeStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface ChromePermissionsApi {
  contains(input: { origins?: string[] }): Promise<boolean>;
  request(input: { origins?: string[] }): Promise<boolean>;
}

interface ChromeTabsApi {
  get(tabId: number): Promise<ChromeTab>;
  update(tabId: number, updateProperties: { url?: string; active?: boolean }): Promise<ChromeTab>;
  captureVisibleTab(windowId?: number, options?: { format?: string }): Promise<string>;
  onUpdated: ChromeListener<(tabId: number, changeInfo: { status?: string }) => void>;
}

interface ChromeWindowsApi {
  create(createData: {
    url?: string;
    type?: string;
    focused?: boolean;
    state?: string;
  }): Promise<ChromeWindow>;
  get(windowId: number): Promise<ChromeWindow>;
  update(
    windowId: number,
    updateInfo: {
      focused?: boolean;
      state?: string;
    }
  ): Promise<ChromeWindow>;
}

interface ChromeScriptingApi {
  executeScript<T>(input: {
    target: { tabId: number };
    func: (...args: never[]) => T | Promise<T>;
    args?: unknown[];
  }): Promise<Array<{ result?: T }>>;
}

interface ChromeActionApi {
  setBadgeText(details: { text: string }): Promise<void>;
  setBadgeBackgroundColor(details: { color: string }): Promise<void>;
}

interface ChromeRuntimeApi {
  connect(connectInfo?: { name?: string }): ChromeRuntimePort;
  sendMessage(message: unknown): Promise<unknown>;
  getURL(path: string): string;
  onConnect: ChromeListener<(port: ChromeRuntimePort) => void>;
  onMessage: ChromeListener<
    (
      message: unknown,
      sender: ChromeMessageSender,
      sendResponse: (response: unknown) => void
    ) => boolean | void
  >;
  onMessageExternal: ChromeListener<
    (
      message: unknown,
      sender: ChromeMessageSender,
      sendResponse: (response: unknown) => void
    ) => boolean | void
  >;
}

declare const chrome: {
  action: ChromeActionApi;
  permissions: ChromePermissionsApi;
  runtime: ChromeRuntimeApi;
  scripting: ChromeScriptingApi;
  storage: { local: ChromeStorageArea };
  tabs: ChromeTabsApi;
  windows: ChromeWindowsApi;
};
