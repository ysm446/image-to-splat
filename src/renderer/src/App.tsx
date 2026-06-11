import { useCallback, useEffect, useRef, useState } from 'react'
import { Viewer, type SplatFormat } from './components/Viewer'
import { ParamPanel, type GenParams, type DisplayParams, type RenderMode } from './components/ParamPanel'
import { StatusBar } from './components/StatusBar'
import {
  fileUrl,
  getGpu,
  getProgress,
  getWeights,
  startGenerate,
  type GpuInfo,
  type Progress
} from './api'

const SPLAT_EXTS = ['ply', 'splat', 'ksplat', 'spz']

function formatFromPath(path: string): SplatFormat {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'splat') return 'splat'
  if (ext === 'ksplat') return 'ksplat'
  if (ext === 'spz') return 'spz'
  return 'ply'
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 経過時間を「12.3秒」または「1:23」形式にする。 */
function formatElapsed(ms: number): string {
  const totalSec = ms / 1000
  if (totalSec < 60) return `${totalSec.toFixed(1)}秒`
  const m = Math.floor(totalSec / 60)
  const s = Math.floor(totalSec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const PANEL_MIN = 220
const PANEL_DEFAULT = 300
const panelMax = (): number => Math.max(PANEL_MIN, Math.round(window.innerWidth * 0.4))
const clampPanel = (w: number): number => Math.min(panelMax(), Math.max(PANEL_MIN, w))

export default function App(): JSX.Element {
  const [ready, setReady] = useState(false)
  const [gpu, setGpu] = useState<GpuInfo | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const genStartRef = useRef(0)

  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT)
  const [resizing, setResizing] = useState(false)
  const dragState = useRef<{ startX: number; startW: number } | null>(null)

  const [imagePath, setImagePath] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [preparedUrl, setPreparedUrl] = useState<string | null>(null)
  const [splatUrl, setSplatUrl] = useState<string | null>(null)
  const [format, setFormat] = useState<SplatFormat>('ply')

  const [weightsReady, setWeightsReady] = useState(false)
  const [gen, setGen] = useState<GenParams>({
    maxGaussians: 65536,
    seed: 0,
    steps: 20,
    guidanceScale: 3.0,
    removeBg: true
  })
  const [display, setDisplay] = useState<DisplayParams>({
    backgroundColor: '#1a1a1a',
    alphaRemovalThreshold: 1,
    flipY: true, // 3DGS/SPZ など Y-down データが多いため既定で反転
    showGrid: true,
    renderMode: 'splat'
  })

  // サイドカーの状態購読
  useEffect(() => {
    window.api.getSidecarStatus().then((s) => setReady(s.ready))
    const off = window.api.onSidecarStatus((s) => {
      setReady(s.ready)
      if (s.ready) getGpu().then(setGpu).catch(() => undefined)
    })
    return () => off?.()
  }, [])

  // ready になったら GPU 情報と重み状態を取得
  useEffect(() => {
    if (ready) {
      getGpu().then(setGpu).catch(() => undefined)
      getWeights()
        .then((w) => setWeightsReady(w.ready))
        .catch(() => undefined)
    }
  }, [ready])

  async function setInputImage(p: string): Promise<void> {
    setImagePath(p)
    setImageUrl(await fileUrl(p))
    setPreparedUrl(null) // 新しい入力では前処理後プレビューをリセット
    setMessage(`画像を選択: ${basename(p)}`)
  }

  async function loadSplat(p: string): Promise<void> {
    setFormat(formatFromPath(p))
    setSplatUrl(await fileUrl(p))
    setMessage(`読み込み: ${basename(p)}`)
  }

  async function pickImage(): Promise<void> {
    const p = await window.api.openImageDialog()
    if (p) await setInputImage(p)
  }

  async function openSplat(): Promise<void> {
    const p = await window.api.openSplatDialog()
    if (p) await loadSplat(p)
  }

  async function runGenerate(): Promise<void> {
    if (!imagePath) return
    setBusy(true)
    genStartRef.current = Date.now()
    setElapsedMs(0)
    setProgress({ state: 'preparing', step: 0, total: gen.steps })
    setPreparedUrl(null)
    setMessage('生成を開始しました…')
    try {
      const { jobId } = await startGenerate({
        imagePath,
        maxGaussians: gen.maxGaussians,
        seed: gen.seed,
        steps: gen.steps,
        guidanceScale: gen.guidanceScale,
        removeBg: gen.removeBg
      })
      // 進捗をポーリング
      for (;;) {
        await sleep(400)
        const p = await getProgress(jobId)
        setProgress(p)
        if (p.state === 'done') {
          if (p.preparedPath) setPreparedUrl(await fileUrl(p.preparedPath))
          if (p.outputPath) {
            setFormat(formatFromPath(p.outputPath))
            setSplatUrl(await fileUrl(p.outputPath))
            setMessage(`生成完了（${formatElapsed(Date.now() - genStartRef.current)}）`)
          }
          break
        }
        if (p.state === 'error') {
          setMessage(`生成エラー: ${p.message ?? 'unknown'}`)
          break
        }
      }
    } catch (e) {
      setMessage(`生成エラー: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  async function handleDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    const path = window.api.getPathForFile(file)
    if (!path) {
      setMessage('ドロップされたファイルのパスを取得できませんでした')
      return
    }
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    if (SPLAT_EXTS.includes(ext)) {
      await loadSplat(path)
    } else {
      await setInputImage(path)
    }
  }

  function handleDragOver(e: React.DragEvent): void {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  // サイドバーのリサイズ
  const startResize = useCallback(
    (e: React.MouseEvent): void => {
      e.preventDefault()
      dragState.current = { startX: e.clientX, startW: panelWidth }
      setResizing(true)
    },
    [panelWidth]
  )

  useEffect(() => {
    if (!resizing) return
    const onMove = (e: MouseEvent): void => {
      const s = dragState.current
      if (!s) return
      setPanelWidth(clampPanel(s.startW + (e.clientX - s.startX)))
    }
    const onUp = (): void => setResizing(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [resizing])

  // ウィンドウ縮小時に最大幅を超えないよう追従
  useEffect(() => {
    const onResize = (): void => setPanelWidth((w) => clampPanel(w))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 生成中は経過時間をライブ更新する
  useEffect(() => {
    const active = progress && progress.state !== 'done' && progress.state !== 'error'
    if (!active) return
    setElapsedMs(Date.now() - genStartRef.current)
    const id = setInterval(() => setElapsedMs(Date.now() - genStartRef.current), 100)
    return () => clearInterval(id)
  }, [progress])

  return (
    <div
      className={`app${resizing ? ' resizing' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <div className="main">
        <ParamPanel
          width={panelWidth}
          gen={gen}
          display={display}
          onGenChange={setGen}
          onDisplayChange={setDisplay}
          onPickImage={pickImage}
          onGenerate={runGenerate}
          onOpenSplat={openSplat}
          imagePath={imagePath}
          imageUrl={imageUrl}
          preparedUrl={preparedUrl}
          currentFormat={splatUrl ? format : null}
          busy={busy}
          weightsReady={weightsReady}
          progress={progress}
          elapsedText={formatElapsed(elapsedMs)}
        />
        <div
          className={`resize-handle${resizing ? ' active' : ''}`}
          onMouseDown={startResize}
          onDoubleClick={() => setPanelWidth(PANEL_DEFAULT)}
          role="separator"
          aria-orientation="vertical"
          aria-label="サイドバーの幅を変更（ダブルクリックで標準幅）"
          title="ドラッグで幅を変更 / ダブルクリックで標準幅"
        />
        <div className="viewer-wrap">
          {splatUrl ? (
            <>
              <Viewer
                splatUrl={splatUrl}
                format={format}
                backgroundColor={display.backgroundColor}
                alphaRemovalThreshold={display.alphaRemovalThreshold}
                flipY={display.flipY}
                showGrid={display.showGrid}
                pointCloud={display.renderMode === 'point'}
                onLoadingChange={(l) => setBusy(l)}
                onError={(m) => setMessage(`表示エラー: ${m}`)}
              />
              <div className="viewport-toolbar">
                <label className="vp-select">
                  <span>表示</span>
                  <select
                    value={display.renderMode}
                    onChange={(e) =>
                      setDisplay({ ...display, renderMode: e.target.value as RenderMode })
                    }
                    aria-label="表示モード"
                  >
                    <option value="splat">スプラット</option>
                    <option value="point">ポイントクラウド</option>
                  </select>
                </label>
              </div>
            </>
          ) : (
            <div className="empty">
              <p>
                画像を選んで「生成する」、または .ply / .splat / .spz を開いてください。
                <br />
                画像や Gaussian ファイルをウィンドウにドラッグ&ドロップして読み込めます。
              </p>
            </div>
          )}
        </div>
      </div>
      <StatusBar ready={ready} gpu={gpu} message={message} />
    </div>
  )
}
