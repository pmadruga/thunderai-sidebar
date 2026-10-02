/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

/*
 * chatPanel experiment: hosts the ThunderAI chat page in a panel docked on the
 * right of a main window, instead of a separate popup window.
 *
 * The panel lives at the end of #tabmail-container, Thunderbird's extension
 * point for side panes (the calendar Today pane uses it too), so it stays
 * visible across tabs. The browser is set up the same way Thunderbird sets up
 * extension popups (ExtensionPopups.sys.mjs), so the page gets the full
 * WebExtension API in the extension process.
 */

"use strict";

var { ExtensionParent } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionParent.sys.mjs"
);
var { ExtensionUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionUtils.sys.mjs"
);
var { ExtensionError } = ExtensionUtils;

const PANEL_ID = "thunderai-chat-panel";
const SPLITTER_ID = "thunderai-chat-panel-splitter";
const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 300;
const XULSTORE_DOC = "chrome://messenger/content/messenger.xhtml";

function savedWidth() {
  const value = Number(Services.xulStore.getValue(XULSTORE_DOC, PANEL_ID, "width"));
  return value >= MIN_WIDTH ? value : DEFAULT_WIDTH;
}

function removePanel(doc) {
  doc.getElementById(PANEL_ID)?.remove();
  doc.getElementById(SPLITTER_ID)?.remove();
}

function allMailWindows() {
  return [...Services.wm.getEnumerator("mail:3pane")];
}

function createPanel(doc, extension) {
  const container = doc.getElementById("tabmail-container");

  const splitter = doc.createXULElement("splitter");
  splitter.id = SPLITTER_ID;
  splitter.setAttribute("resizebefore", "flex");
  splitter.setAttribute("resizeafter", "closest");
  splitter.style.cssText =
    "min-width: 5px; width: 5px; margin-inline: -2px; background: transparent; " +
    "border: none; border-inline-start: 1px solid var(--layout-border-0, rgba(127,127,127,.25)); " +
    "z-index: 1; cursor: ew-resize;";

  const panel = doc.createXULElement("vbox");
  panel.id = PANEL_ID;
  panel.setAttribute("width", String(savedWidth()));
  panel.style.cssText =
    `min-width: ${MIN_WIDTH}px; width: ${savedWidth()}px; ` +
    "background-color: var(--layout-background-1, Canvas); color: var(--layout-color-1, CanvasText);";

  // The extension browser, configured like Thunderbird's extension popups
  const browser = doc.createXULElement("browser");
  browser.setAttribute("type", "content");
  browser.setAttribute("disableglobalhistory", "true");
  browser.setAttribute("messagemanagergroup", "webext-browsers");
  browser.setAttribute("webextension-view-type", "popup");
  browser.setAttribute("tooltip", "aHTMLTooltip");
  browser.setAttribute("context", "browserContext");
  browser.setAttribute("autocompletepopup", "PopupAutoComplete");
  browser.setAttribute("selectmenulist", "ContentSelectDropdown");
  browser.setAttribute("datetimepicker", "DateTimePickerPanel");
  browser.toggleAttribute("nodefaultsrc", true);
  browser.setAttribute("maychangeremoteness", "true");
  browser.setAttribute(
    "initialBrowsingContextGroupId",
    extension.policy.browsingContextGroupId
  );
  if (extension.remote) {
    browser.toggleAttribute("remote", true);
    browser.setAttribute("remoteType", extension.remoteType);
  }
  browser.setAttribute("flex", "1");
  browser.style.cssText = "min-height: 0;";

  panel.append(browser);

  // Listen for the frame loader before inserting: it's created during the
  // insertion itself, so a listener added afterwards would never fire.
  const ready = extension.remote
    ? new Promise(resolve =>
        browser.addEventListener("XULFrameLoaderCreated", resolve, { once: true })
      )
    : Promise.resolve();

  container.append(splitter, panel);

  // Remember the width the user drags the panel to
  splitter.addEventListener("mouseup", () => {
    const width = Math.round(panel.getBoundingClientRect().width);
    if (width >= MIN_WIDTH) {
      Services.xulStore.setValue(XULSTORE_DOC, PANEL_ID, "width", String(width));
    }
  });

  const register = () =>
    ExtensionParent.apiManager.emit("extension-browser-inserted", browser);
  browser.addEventListener("DidChangeBrowserRemoteness", register);

  if (!extension.remote) {
    // Non-remote browsers need their content window touched to initialise.
    browser.contentWindow;
  }
  panel._thunderaiReady = ready.then(() => {
    register();
    return browser;
  });
  return panel;
}

this.chatPanel = class extends ExtensionAPI {
  getAPI(context) {
    const extension = context.extension;
    return {
      chatPanel: {
        async open(windowId, url) {
          const win = extension.windowManager.get(windowId, context)?.window;
          const doc = win?.document;
          if (!doc?.getElementById("tabmail-container")) {
            return false;
          }
          // Only load pages from this extension.
          if (!url.startsWith(extension.baseURL)) {
            throw new ExtensionError("chatPanel can only load extension pages");
          }
          const panel = doc.getElementById(PANEL_ID) ?? createPanel(doc, extension);
          // If the browser never becomes ready, report failure so the caller
          // falls back to a normal window instead of waiting forever.
          const browser = await Promise.race([
            panel._thunderaiReady,
            new Promise(resolve => win.setTimeout(() => resolve(null), 5000)),
          ]);
          if (!browser) {
            removePanel(doc);
            return false;
          }
          browser.fixupAndLoadURIString(url, {
            triggeringPrincipal: extension.principal,
          });
          return true;
        },

        async getTheme(windowId) {
          const win = extension.windowManager.get(windowId, context)?.window;
          const doc = win?.gTabmail?.currentAbout3Pane?.document ?? win?.document;
          if (!doc?.body) {
            return null;
          }
          // Resolve the theme's tokens by applying them to a hidden probe, so
          // var() chains and light-dark() come back as plain rgb() values.
          const probe = doc.createElement("div");
          probe.style.cssText = "position: absolute; visibility: hidden; pointer-events: none;";
          doc.body.append(probe);
          const view = doc.defaultView;
          const resolve = (property, value) => {
            probe.style.setProperty(property, value);
            const result = view.getComputedStyle(probe).getPropertyValue(property);
            probe.style.removeProperty(property);
            return result;
          };
          const theme = {
            background: resolve("background-color", "var(--layout-background-1, Canvas)"),
            text: resolve("color", "var(--layout-color-1, CanvasText)"),
            text2: resolve("color", "var(--layout-color-2, GrayText)"),
            text3: resolve("color", "var(--layout-color-3, GrayText)"),
            border: resolve("color", "var(--layout-border-0, GrayText)"),
            accent: resolve("color", "var(--selected-item-color, AccentColor)"),
            accentText: resolve("color", "var(--selected-item-text-color, AccentColorText)"),
            font: view.getComputedStyle(doc.body).fontFamily,
          };
          probe.remove();
          return theme;
        },

        async isOpen(windowId) {
          const win = extension.windowManager.get(windowId, context)?.window;
          return !!win?.document.getElementById(PANEL_ID);
        },

        async getThreadMessages(messageId) {
          const hdr = extension.messageManager.get(messageId);
          const db = hdr?.folder?.msgDatabase;
          const thread = db?.getThreadContainingMsgHdr(hdr);
          if (!thread) {
            return null;
          }
          const gone = Ci.nsMsgMessageFlags.IMAPDeleted | Ci.nsMsgMessageFlags.Expunged;
          const messages = [];
          for (let i = 0; i < thread.numChildren; i++) {
            const child = thread.getChildHdrAt(i);
            if (child && !(child.flags & gone)) {
              const message = extension.messageManager.convert(child);
              if (message) {
                messages.push(message);
              }
            }
          }
          return messages;
        },

        async close() {
          for (const win of allMailWindows()) {
            removePanel(win.document);
          }
        },
      },
    };
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      return;
    }
    for (const win of allMailWindows()) {
      removePanel(win.document);
    }
  }
};
