import { useEffect, useState } from 'react'
import { Viewer, type SplatFormat } from './components/Viewer'
import { ParamPanel, type GenParams, type DisplayParams } from './components/ParamPanel'
import { StatusBar } from './components/StatusBar'
import { fileUrl, generate, getGpu, getWeights, type GpuInfo } from './api'

function formatFromPath(path: string): SplatFormat {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'splat') return 'splat'
  if (ext === 'ksplat') return 'ksplat'
  if (ext === 'spz') return 'spz'
  return 'ply'
}

export default function App(): JSX.Element {
  const [ready, setReady] = useState(false)
  const [gpu, setGpu] = useState<GpuInfo | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const [imagePath, setImagePath] = useState<string | null>(null)
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
    let off: (() => void) | undefined
    window.api.getSidecarStatus().then((s) => setReady(s.ready))
    off = window.api.onSidecarStatus((s) => {
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

  async function pickImage(): Promise<void> {
    const p = await window.api.openImageDialog()
    if (p) {
      setImagePath(p)
      setMessage(`画像を選択: ${p.split(/[\\/]/).pop()}`)
    }
  }

  async function openSplat(): Promise<void> {
    const p = await window.api.openSplatDialog()
    if (!p) return
    setFormat(formatFromPath(p))
    setSplatUrl(await fileUrl(p))
    setMessage(`読み込み: ${p.split(/[\\/]/).pop()}`)
  }

  async function runGenerate(): Promise<void> {
    if (!imagePath) return
    setBusy(true)
    setMessage('生成リクエスト送信中…')
    try {
      const res = await generate({
        imagePath,
        maxGaussians: gen.maxGaussians,
        seed: gen.seed,
        steps: gen.steps,
        guidanceScale: gen.guidanceScale
      })
      if (res.status === 'ok' && res.outputPath) {
        setFormat(formatFromPath(res.outputPath))
        setSplatUrl(await fileUrl(res.outputPath))
        setMessage('生成完了')
      } else {
        setMessage(res.message ?? `生成: ${res.status}`)
      }
    } catch (e) {
      setMessage(`生成エラー: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app">
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
          currentFormat={splatUrl ? format : null}
          busy={busy}
          weightsReady={weightsReady}
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
              <p>画像を選んで「生成する」、または .ply / .splat を開いてください。</p>
            </div>
          )}
        </div>
      </div>
      <StatusBar ready={ready} gpu={gpu} message={message} />
    </div>
  )
}
