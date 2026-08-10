const { Menu, shell, dialog } = require('electron');
const electron = require('electron');
const app = electron.app;
const {
  pathsAgama,
  pathsDaemons,
} = require('../routes/api/pathsUtil');
const api = require('../routes/api');
const { promptUpdate, generateDiagnosticPacket } = api;
const { VERUS_DISCORD, VERUS_WIKI } = require('../routes/api/utils/constants/urls')

const template = [
  {
    label: 'Edit',
    submenu: [
      {
        role: 'undo'
      },
      {
        role: 'redo'
      },
      {
        type: 'separator'
      },
      {
        role: 'cut'
      },
      {
        role: 'copy'
      },
      {
        role: 'paste'
      },
      {
        role: 'pasteandmatchstyle'
      },
      {
        role: 'delete'
      },
      {
        role: 'selectall'
      }
    ]
  },
  {
    label: 'View',
    submenu: [
      {
        label: 'Reload',
        accelerator: 'CmdOrCtrl+R',
        click (item, focusedWindow) {
          if (focusedWindow)
            focusedWindow.reload();
        }
      },
      ...(api.isDevMode === true ? [{
        label: 'Toggle Developer Tools',
        accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I',
        click (item, focusedWindow) {
          if (focusedWindow)
            focusedWindow.webContents.toggleDevTools();
        }
      }] : []),
      {
        type: 'separator'
      },
      {
        role: 'resetzoom'
      },
      {
        role: 'zoomin'
      },
      {
        role: 'zoomout'
      },
      {
        type: 'separator'
      },
      {
        role: 'togglefullscreen'
      }
    ]
  },
  {
    role: 'window',
    submenu: [
      {
        role: 'minimize'
      },
      {
        role: 'close'
      }
    ]
  },
  {
    role: 'help',
    label: 'Help',
    submenu: [
      {
        label: 'Join our Discord',
        click (item, focusedWindow) {
          shell.openExternal(VERUS_DISCORD);
        }
      },
      {
        label: 'Verus Wiki',
        click (item, focusedWindow) {
          shell.openExternal(VERUS_WIKI);
        }
      },
      {
        label: 'Show Verus Desktop Wallet data folder',
        click (item, focusedWindow) {
          shell.openPath(pathsAgama(null, global.HOME).paths.agamaDir);
        }
      },
      {
        label: 'Show Verus data folder (default)',
        click (item, focusedWindow) {
          shell.openPath(pathsDaemons().paths.vrscDataDir);
        }
      },
      {
        label: 'Show binary folder',
        click (item, focusedWindow) {
          shell.openPath(pathsDaemons().paths.assetsFolder);
        }
      },
      {
        label: 'Generate diagnostic packet',
        click (item, focusedWindow) {
          generateDiagnosticPacket(focusedWindow)
        }
      },
      {
        label: 'Bootstrap VRSC',
        click (item, focusedWindow) {
          dialog.showMessageBox({
            type: "info",
            title: "Bootstrap VRSC",
            message:
              "To bootstrap VRSC, select the 'Bootstrap' checkbox when adding the coin in native mode, or select 'Bootstrap' from the VRSC cog menu located beneath the Verus coin selection in the 'wallet' tab.",
            buttons: ["OK"],
          });
        }
      },
      {
        label: "Check for updates",
        click (item, focusedWindow) {
          promptUpdate(focusedWindow, true)
        }
      }
    ]
  }
];

if (process.platform === 'darwin') {
  const name = app.getName();

  template.unshift({
    label: name,
    submenu: [
      {
        role: 'about'
      },
      {
        type: 'separator'
      },
      {
        role: 'services',
        submenu: []
      },
      {
        type: 'separator'
      },
      {
        role: 'hide'
      },
      {
        role: 'hideothers'
      },
      {
        role: 'unhide'
      },
      {
        type: 'separator'
      },
      {
        label: 'Quit',
        accelerator: 'CmdOrCtrl+Q',
        role: 'close'
      }
    ]
  });
  // Edit menu.
  template[1].submenu.push(
    {
      type: 'separator'
    },
    {
      label: 'Speech',
      submenu: [
        {
          role: 'startspeaking'
        },
        {
          role: 'stopspeaking'
        }
      ]
    }
  );
  // Window menu.
  template[3].submenu = [
    {
      label: 'Close',
      accelerator: 'CmdOrCtrl+W',
      role: 'close'
    },
    {
      label: 'Minimize',
      accelerator: 'CmdOrCtrl+M',
      role: 'minimize'
    },
    {
      label: 'Zoom',
      role: 'zoom'
    },
    {
      type: 'separator'
    },
    {
      label: 'Bring All to Front',
      role: 'front'
    }
  ]
}

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);
