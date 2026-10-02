/**
 * The application menu and the right-click menu. Electron's default application menu carries
 * reload and the developer tools into a release build, and there is no right-click menu at all
 * until one is built.
 */
import { app, clipboard, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from "electron";

export type NavDirection = "back" | "forward";

const MAC = process.platform === "darwin";
/** `COMICAL_DEBUG` keeps the developer tools reachable in an installed build. */
const DEV_TOOLS = !app.isPackaged || !!process.env.COMICAL_DEBUG;

/** On Windows and Linux the menu bar is never drawn (the caption overlay replaces the title bar),
 *  so this is a set of keyboard shortcuts there; only macOS shows it. */
export function setAppMenu(navigate: (win: BrowserWindow, dir: NavDirection) => void): void {
  const go = (dir: NavDirection) => (_item: unknown, win: unknown) => {
    if (win) navigate(win as BrowserWindow, dir);
  };
  const template: MenuItemConstructorOptions[] = [
    ...(MAC ? [{ role: "appMenu" } as const] : [{ role: "fileMenu" } as const]),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        ...(DEV_TOOLS
          ? ([{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, { type: "separator" }] as const)
          : []),
        { role: "resetZoom" },
        { role: "zoomIn" },
        // The role's own accelerator is Ctrl+Plus, which on most layouts means holding Shift too.
        { role: "zoomIn", accelerator: "CommandOrControl+=", visible: false },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Go",
      submenu: [
        { label: "Back", accelerator: MAC ? "Command+[" : "Alt+Left", click: go("back") },
        { label: "Forward", accelerator: MAC ? "Command+]" : "Alt+Right", click: go("forward") },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

/** Only where the page left the right-click alone: the app's own menus cancel the event, and
 *  Chromium then never asks for one. */
export function attachContextMenu(win: BrowserWindow, appOrigin: string): void {
  const contents = win.webContents;
  contents.on("context-menu", (_e, p) => {
    const groups: MenuItemConstructorOptions[][] = [];

    if (p.misspelledWord) {
      groups.push([
        ...p.dictionarySuggestions.slice(0, 5).map((word) => ({
          label: word,
          click: () => contents.replaceMisspelling(word),
        })),
        {
          label: "Add to dictionary",
          click: () => contents.session.addWordToSpellCheckerDictionary(p.misspelledWord),
        },
      ]);
    }

    if (p.isEditable) {
      const f = p.editFlags;
      groups.push(
        [
          { role: "undo", enabled: f.canUndo },
          { role: "redo", enabled: f.canRedo },
        ],
        [
          { role: "cut", enabled: f.canCut },
          { role: "copy", enabled: f.canCopy },
          { role: "paste", enabled: f.canPaste },
        ],
        [{ role: "selectAll", enabled: f.canSelectAll }],
      );
    } else if (p.selectionText.trim()) {
      groups.push([{ role: "copy" }]);
    }

    // A link into the app itself points at this launch's loopback port, which is no use anywhere else.
    if (p.linkURL && isWebUrl(p.linkURL) && !p.linkURL.startsWith(appOrigin)) {
      const url = p.linkURL;
      groups.push([
        { label: "Open link in browser", click: () => void shell.openExternal(url) },
        { label: "Copy link", click: () => clipboard.writeText(url) },
      ]);
    }

    if (p.mediaType === "image" && p.hasImageContents) {
      groups.push([{ label: "Copy image", click: () => contents.copyImageAt(p.x, p.y) }]);
    }

    if (DEV_TOOLS) groups.push([{ label: "Inspect element", click: () => contents.inspectElement(p.x, p.y) }]);

    const items = groups.flatMap((group, i) => (i ? [{ type: "separator" } as const, ...group] : group));
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
}
