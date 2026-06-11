import { app, BrowserWindow, Menu, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { spawn, ChildProcess } from 'child_process'
import { AddressInfo, createServer } from 'net'
import { existsSync } from 'fs'

let mainWindow: BrowserWindow | null = null
let sidecar: ChildProcess | null = null
let sidecarPort = 0
let sidecarReady = false
const sidecarLog: string[] = []

const isDev = !app.isPackaged

/** 空きポートを 1 つ確保する。固定ポートは避ける。 */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port
      srv.close(() => resolve(port))
    })
  })
}

/** 同梱 venv の Python を優先し、無ければシステム Python にフォールバックする。 */
function resolvePythonExe(pythonDir: string): string {
  const venvPython =
    process.platform === 'win32'
      ? join(pythonDir, '.venv', 'Scripts', 'python.exe')
      : join(pythonDir, '.venv', 'bin', 'python')
  if (existsSync(venvPython)) return venvPython
  return process.platform === 'win32' ? 'python' : 'python3'
}

function pushLog(line: string): void {
  sidecarLog.push(line)
  if (sidecarLog.length > 500) sidecarLog.shift()
  mainWindow?.webContents.send('sidecar:log', line)
}

/** Python サイドカー（FastAPI）を spawn する。 */
function startSidecar(): void {
  const projectRoot = isDev ? join(__dirname, '../..') : process.resourcesPath
  const pythonDir = join(projectRoot, 'python')
  const pythonExe = resolvePythonExe(pythonDir)
  const serverPath = join(pythonDir, 'server.py')

  pushLog(`[main] starting sidecar: ${pythonExe} ${serverPath} --port ${sidecarPort}`)

  sidecar = spawn(pythonExe, [serverPath, '--port', String(sidecarPort)], {
    cwd: pythonDir,
    env: { ...process.env, PYTHONUNBUFFERED: '1' }
  })

  sidecar.stdout?.on('data', (d: Buffer) => pushLog(`[py] ${d.toString().trimEnd()}`))
  sidecar.stderr?.on('data', (d: Buffer) => pushLog(`[py:err] ${d.toString().trimEnd()}`))
  sidecar.on('exit', (code) => {
    sidecarReady = false
    pushLog(`[main] sidecar exited with code ${code}`)
    mainWindow?.webContents.send('sidecar:status', { ready: false, port: sidecarPort })
  })
  sidecar.on('error', (err) => {
    pushLog(`[main] failed to start sidecar: ${err.message}`)
  })
}

/** /health が応答するまでポーリングする。 */
async function waitForSidecar(timeoutMs = 30000): Promise<boolean> {
  const base = `http://127.0.0.1:${sidecarPort}`
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/health`)
      if (res.ok) {
        sidecarReady = true
        pushLog('[main] sidecar is ready')
        mainWindow?.webContents.send('sidecar:status', { ready: true, port: sidecarPort })
        return true
      }
    } catch {
      // まだ起動していない
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  pushLog('[main] sidecar did not become ready in time')
  return false
}

function stopSidecar(): void {
  if (sidecar && !sidecar.killed) {
    pushLog('[main] stopping sidecar')
    sidecar.kill()
    sidecar = null
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    useContentSize: true, // width/height をコンテンツ（描画領域）基準にする
    show: false,
    backgroundColor: '#1a1a1a',
    title: 'Image to Splat',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // 上部メニュー（File / Edit など）を非表示にする
  Menu.setApplicationMenu(null)

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    // メニューを消すと既定のアクセラレータが無くなるため、DevTools 開閉を手動で割り当てる
    mainWindow.webContents.on('before-input-event', (_e, input) => {
      const toggle =
        input.key === 'F12' ||
        (input.control && input.shift && input.key.toLowerCase() === 'i')
      if (input.type === 'keyDown' && toggle) {
        mainWindow?.webContents.toggleDevTools()
      }
    })
  }

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    // DevTools は起動時に自動で開かない（F12 / Ctrl+Shift+I で開く）
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ---- IPC ----
ipcMain.handle('sidecar:port', () => sidecarPort)
ipcMain.handle('sidecar:status', () => ({ ready: sidecarReady, port: sidecarPort }))
ipcMain.handle('sidecar:log', () => sidecarLog)

ipcMain.handle('dialog:openImage', async () => {
  const res = await dialog.showOpenDialog(mainWindow!, {
    title: '入力画像を選択',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
  })
  return res.canceled ? null : res.filePaths[0]
})

ipcMain.handle('dialog:openSplat', async () => {
  const res = await dialog.showOpenDialog(mainWindow!, {
    title: 'Gaussian ファイルを選択',
    properties: ['openFile'],
    filters: [{ name: 'Gaussian Splats', extensions: ['ply', 'splat', 'ksplat', 'spz'] }]
  })
  return res.canceled ? null : res.filePaths[0]
})

// 多重起動を防ぐ（同じ userData キャッシュの取り合いを避ける）。
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    sidecarPort = await getFreePort()
    createWindow()
    startSidecar()
    waitForSidecar()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    stopSidecar()
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', stopSidecar)
}
