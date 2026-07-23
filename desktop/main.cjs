const { app, BrowserWindow, Menu, shell, session } = require("electron");
const path = require("node:path");

const APP_URL = "https://rotina-de-verificacao.vercel.app/verificacao-operacional";
const APP_ORIGIN = new URL(APP_URL).origin;

function isAppUrl(url) {
  try {
    return new URL(url).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

function showOfflinePage(window) {
  if (!window.isDestroyed()) {
    void window.loadFile(path.join(__dirname, "offline.html"));
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1536,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: "Rotina de Verificação",
    icon: path.join(__dirname, "assets", "icon.png"),
    backgroundColor: "#f7f9fc",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.once("ready-to-show", () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) return { action: "allow" };
    void shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url) || url.startsWith("file:")) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, _errorDescription, validatedUrl, isMainFrame) => {
      if (isMainFrame && errorCode !== -3 && isAppUrl(validatedUrl)) {
        showOfflinePage(window);
      }
    },
  );

  window.webContents.on("render-process-gone", () => showOfflinePage(window));
  void window.loadURL(APP_URL);
}

app.setAppUserModelId("com.mv2.rotinadeverificacao");

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
