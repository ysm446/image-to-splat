import { contextBridge, ipcRenderer } from 'electron'

export interface SidecarStatus {
  ready: boolean
  port: number
}

const api = {
  /** サイドカーのポート番号を取得する。 */
  getSidecarPort: (): Promise<number> => ipcRenderer.invoke('sidecar:port'),
  /** サイドカーの ready 状態とポートを取得する。 */
  getSidecarStatus: (): Promise<SidecarStatus> => ipcRenderer.invoke('sidecar:status'),
  /** これまでのサイドカーログを取得する。 */
  getSidecarLog: (): Promise<string[]> => ipcRenderer.invoke('sidecar:log'),
  /** 入力画像をダイアログで選ぶ。キャンセル時は null。 */
  openImageDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:openImage'),
  /** .ply / .splat / .ksplat をダイアログで選ぶ。キャンセル時は null。 */
  openSplatDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:openSplat'),
  /** サイドカーの状態変化を購読する。 */
  onSidecarStatus: (cb: (s: SidecarStatus) => void): (() => void) => {
    const listener = (_e: unknown, s: SidecarStatus): void => cb(s)
    ipcRenderer.on('sidecar:status', listener)
    return () => ipcRenderer.removeListener('sidecar:status', listener)
  },
  /** サイドカーログの追記を購読する。 */
  onSidecarLog: (cb: (line: string) => void): (() => void) => {
    const listener = (_e: unknown, line: string): void => cb(line)
    ipcRenderer.on('sidecar:log', listener)
    return () => ipcRenderer.removeListener('sidecar:log', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
