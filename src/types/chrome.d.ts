interface ChromeMessageSender {}

interface ChromeRuntime {
  getURL(path: string): string;
  onMessage: {
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

declare const chrome: {
  runtime: ChromeRuntime;
  tabs: {
    query(queryInfo: { active: boolean; currentWindow: boolean }): Promise<ChromeTab[]>;
    get(tabId: number): Promise<ChromeTab>;
    create(createProperties: { url: string }): Promise<ChromeTab>;
  };
  scripting: ChromeScripting;
  downloads: {
    download(options: ChromeDownloadOptions): Promise<number>;
  };
};
