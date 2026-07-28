/**
 * 应用菜单。
 *
 * 分组与侧边栏保持一致 —— 用户在两处看到的是同一套结构，
 * 不必在脑子里维护两份心智模型。
 */

import { Menu } from 'electron'
import { broadcast } from './ipc/index.js'

export function buildMenu(): void {
  const navigate = (view: string) => broadcast({ type: 'navigate', view })

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            role: 'appMenu' as const,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: '设置…',
                accelerator: 'Cmd+,',
                click: () => broadcast({ type: 'command', action: 'settings' }),
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: '文件',
      submenu: [
        {
          label: '新建记忆',
          accelerator: 'CmdOrCtrl+N',
          click: () => broadcast({ type: 'command', action: 'new-memory' }),
        },
        {
          label: '搜索…',
          accelerator: 'CmdOrCtrl+K',
          click: () => broadcast({ type: 'command', action: 'palette' }),
        },
        ...(process.platform === 'darwin'
          ? []
          : [
              { type: 'separator' as const },
              {
                label: '设置…',
                accelerator: 'Ctrl+,',
                click: () => broadcast({ type: 'command', action: 'settings' }),
              },
            ]),
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '概览', accelerator: 'CmdOrCtrl+1', click: () => navigate('overview') },
        { type: 'separator' },
        { label: '知识图谱', accelerator: 'CmdOrCtrl+2', click: () => navigate('graph') },
        { label: '记忆库', accelerator: 'CmdOrCtrl+3', click: () => navigate('memories') },
        { label: '文档库', accelerator: 'CmdOrCtrl+4', click: () => navigate('library') },
        { type: 'separator' },
        { label: '待确认', accelerator: 'CmdOrCtrl+5', click: () => navigate('review') },
        { label: '时间线', accelerator: 'CmdOrCtrl+6', click: () => navigate('timeline') },
        { label: '保险箱', accelerator: 'CmdOrCtrl+7', click: () => navigate('vault') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
