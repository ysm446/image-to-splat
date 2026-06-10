import { useEffect, useState } from 'react'
import { Viewer, type SplatFormat } from './components/Viewer'
import { ParamPanel, type GenParams, type DisplayParams } from './components/ParamPanel'
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

export default function App(): JSX.Element {
  const [ready, setReady] = useState(false)
  const [gpu, setGpu] = useState<GpuInfo | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)

  const [imagePath, setImagePath] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [splatUrl, setSplatUrl] = useState<string | null>(null)
  const [format, setFormat] = useState<SplatFormat>('ply')

  const [weightsReady, setWeightsReady] = useState(false)
  const [gen, setGen] = useState<GenParams>({
    maxGaussians: 65536,
    seed: 0,
    steps: 20,
    guidanceScale: 3.0
  })
  const [display, setDisplay] = useState<DisplayParams>({
    backgroundColor: '#1a1a1a',
    alphaRemovalThreshold: 1,
    flipY: true // 3DGS/SPZ など Y-down データが多いため既定で反転
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
    setProgress({ state: 'preparing', step: 0, total: gen.steps })
    setMessage('生成を開始しました…')
    try {
      const { jobId } = await startGenerate({
        imagePath,
        maxGaussians: gen.maxGaussians,
        seed: gen.seed,
        steps: gen.steps,
        guidanceScale: gen.guidanceScale
      })
      // 進捗をポーリング
      for (;;) {
        await sleep(400)
        const p = await getProgress(jobId)
        setProgress(p)
        if (p.state === 'done') {
          if (p.outputPath) {
            setFormat(formatFromPath(p.outputPath))
            setSplatUrl(await fileUrl(p.outputPath))
            setMessage('生成完了')
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

  return (
    <div className="app" onDrop={handleDrop} onDragOver={handleDragOver}>
      <div className="main">
        <ParamPanel
          gen={gen}
          display={display}
          onGenChange={setGen}
          onDisplayChange={setDisplay}
          onPickImage={pickImage}
          onGenerate={runGenerate}
          onOpenSplat={openSplat}
          imagePath={imagePath}
          imageUrl={imageUrl}
          currentFormat={splatUrl ? format : null}
          busy={busy}
          weightsReady={weightsReady}
          progress={progress}
        />
        <div className="viewer-wrap">
          {splatUrl ? (
            <Viewer
              splatUrl={splatUrl}
              format={format}
              backgroundColor={display.backgroundColor}
              alphaRemovalThreshold={display.alphaRemovalThreshold}
              flipY={display.flipY}
              onLoadingChange={(l) => setBusy(l)}
              onError={(m) => setMessage(`表示エラー: ${m}`)}
            />
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
