interface ChromeMessageSender { tab?: ChromeTab }

interface ChromeRuntime {
  getURL(path: string): string;
  onMessage: {
    removeListener(callback: (message: unknown, sender: ChromeMessageSender, sendResponse: (response: unknown) => void) => boolean | void): void;
    addListener(
      callback: (
        message: unknown,
        sender: ChromeMessageSender,
        sendResponse: (response: unknown) => void
      ) => boolean | void
    ): void;
  };
  sendMessage(message: unknown): Promise<unknown>;
}

interface ChromeTab {
  id?: number;
  url?: string;
}

interface ChromeScripting {
  executeScript<Result>(details: {
    target: { tabId: number };
    func: (...args: any[]) => Result | Promise<Result>;
    args?: unknown[];
  }): Promise<Array<{ result: Result }>>;
}

interface ChromeDownloadOptions {
  url: string;
  filename: string;
  saveAs: boolean;
}

interface ChromeDownloadDelta {
  id: number;
  state?: { current: "in_progress" | "complete" | "interrupted" };
}

declare const chrome: {
  runtime: ChromeRuntime;
  action: {
    onClicked: { addListener(callback: (tab: ChromeTab) => void): void };
    setTitle(details: { tabId: number; title: string }): Promise<void>;
  };
  sidePanel: {
    setOptions(options: { tabId: number; path: string; enabled: boolean }): Promise<void>;
    open(options: { tabId: number }): Promise<void>;
  };
  tabs: {
    query(queryInfo: { active: boolean; currentWindow: boolean }): Promise<ChromeTab[]>;
    get(tabId: number): Promise<ChromeTab>;
    create(createProperties: { url: string }): Promise<ChromeTab>;
  };
  scripting: ChromeScripting;
  downloads: {
    download(options: ChromeDownloadOptions): Promise<number>;
    search(query: { id: number }): Promise<Array<{ id: number; state: "in_progress" | "complete" | "interrupted" }>>;
    onChanged: {
      addListener(callback: (delta: ChromeDownloadDelta) => void): void;
      removeListener(callback: (delta: ChromeDownloadDelta) => void): void;
    };
  };
};
