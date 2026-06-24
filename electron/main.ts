// ============================================================
// Electron main process.
//  • dev  (VAULTGATE_DEV=1): loads the running `next dev` server.
//  • prod: boots the Next.js standalone server in-process on a
//          free port, then points the window at it.
// The renderer is fully sandboxed (contextIsolation, no nodeIntegration).
// ============================================================
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import path from "node:path";
import http from "node:http";
import { createServer } from "node:net";

const isDev = process.env.VAULTGATE_DEV === "1";

// Persist all app data (SQLite db, workspaces) under the OS user-data dir.
process.env.VAULTGATE_DATA_DIR = path.join(app.getPath("userData"), "data");

let mainWindow: BrowserWindow | null = null;

Menu.setApplicationMenu(null);

ipcMain.on("window:close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.on("window:minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on("window:toggle-maximize", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
});

ipcMain.on("window:toggle-fullscreen", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  window.setFullScreen(!window.isFullScreen());
});

ipcMain.handle("dialog:openFolder", async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return null;
  const result = await dialog.showOpenDialog(window, {
    properties: ["openDirectory"],
    title: "Select Project Folder",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function waitForServer(url: string, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      http
        .get(url, (res) => {
          res.destroy();
          resolve();
        })
        .on("error", () => {
          if (Date.now() - start > timeoutMs) reject(new Error("Server did not start in time"));
          else setTimeout(tick, 250);
        });
    };
    tick();
  });
}

async function resolveAppUrl(): Promise<string> {
  if (isDev) return "http://localhost:7483";

  // Production: start the Next standalone server bundled by `next build`.
  const port = await getFreePort();
  process.env.PORT = String(port);
  process.env.HOSTNAME = "127.0.0.1";
  // The standalone server lives next to the unpacked app resources.
  const serverPath = path.join(process.resourcesPath, "app", ".next", "standalone", "server.js");
  // Fall back to a local build path when running unpackaged.
  const localServerPath = path.join(__dirname, "..", ".next", "standalone", "server.js");
  const target = require("node:fs").existsSync(serverPath) ? serverPath : localServerPath;
  require(target);
  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url);
  return url;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: "#09090b",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // External links open in the system browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const url = await resolveAppUrl();
  await mainWindow.loadURL(url);
  mainWindow.show();

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
