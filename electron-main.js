const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Open the app maximized.
  win.maximize();

  // Remove Electron's File / Edit / View / Window application menu.
  Menu.setApplicationMenu(null);

  win.loadFile(path.join(__dirname, "index.html"));

  // Hide the page scrollbar while keeping mouse-wheel/trackpad scrolling.
  win.webContents.on("did-finish-load", () => {
    win.webContents.insertCSS(`
      ::-webkit-scrollbar {
        width: 0 !important;
        height: 0 !important;
      }

      html, body {
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
      }
    `).catch(() => {});
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});