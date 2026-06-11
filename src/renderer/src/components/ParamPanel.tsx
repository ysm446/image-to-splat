import type { SplatFormat } from './Viewer'
import type { Progress } from '../api'

export interface GenParams {
  maxGaussians: number
  seed: number
  steps: number
  guidanceScale: number
  removeBg: boolean
}

export interface DisplayParams {
  backgroundColor: string
  alphaRemovalThreshold: number
  flipY: boolean
}

interface ParamPanelProps {
  gen: GenParams
  display: DisplayParams
  onGenChange: (g: GenParams) => void
  onDisplayChange: (d: DisplayParams) => void
  onPickImage: () => void
  onGenerate: () => void
  onOpenSplat: () => void
  imagePath: string | null
  imageUrl: string | null
  preparedUrl: string | null
  currentFormat: SplatFormat | null
  busy: boolean
  weightsReady: boolean
  progress: Progress | null
}

export function ParamPanel(props: ParamPanelProps): JSX.Element {
  const {
    gen,
    display,
    onGenChange,
    onDisplayChange,
    onPickImage,
    onGenerate,
    onOpenSplat,
    imagePath,
    imageUrl,
    preparedUrl,
    currentFormat,
    busy,
    weightsReady,
    progress
  } = props

  return (
    <div className="panel">
      <section className="panel-section">
        <h2>生成</h2>
        <button className="btn" onClick={onPickImage} disabled={busy}>
          入力画像を選択…
        </button>
        <div className="path" title={imagePath ?? ''}>
          {imagePath ? imagePath.split(/[\\/]/).pop() : '未選択'}
        </div>
        {imageUrl && (
          <img className="img-preview" src={imageUrl} alt="入力画像プレビュー" />
        )}
        {preparedUrl && (
          <>
            <div className="path">前処理後（モデル入力 / 背景除去結果）</div>
            <img className="img-preview" src={preparedUrl} alt="前処理後プレビュー" />
          </>
        )}

        <label className="row">
          <span>ガウシアン数 上限</span>
          <span className="value">{gen.maxGaussians.toLocaleString()}</span>
        </label>
        <input
          type="range"
          min={4096}
          max={262144}
          step={4096}
          value={gen.maxGaussians}
          onChange={(e) => onGenChange({ ...gen, maxGaussians: Number(e.target.value) })}
        />

        <label className="row">
          <span>ステップ数</span>
          <span className="value">{gen.steps}</span>
        </label>
        <input
          type="range"
          min={4}
          max={30}
          step={1}
          value={gen.steps}
          onChange={(e) => onGenChange({ ...gen, steps: Number(e.target.value) })}
        />

        <label className="row">
          <span>ガイダンス強度</span>
          <span className="value">{gen.guidanceScale.toFixed(1)}</span>
        </label>
        <input
          type="range"
          min={1}
          max={7}
          step={0.5}
          value={gen.guidanceScale}
          onChange={(e) => onGenChange({ ...gen, guidanceScale: Number(e.target.value) })}
        />

        <label className="row">
          <span>背景除去 (BiRefNet)</span>
          <input
            type="checkbox"
            checked={gen.removeBg}
            onChange={(e) => onGenChange({ ...gen, removeBg: e.target.checked })}
          />
        </label>
        <div className="hint">
          OFF にすると背景を除去せず画像全体を入力します（既にアルファ付きの画像は元々除去されません）
        </div>

        <label className="row">
          <span>シード</span>
        </label>
        <input
          type="number"
          value={gen.seed}
          onChange={(e) => onGenChange({ ...gen, seed: Number(e.target.value) })}
        />

        <button
          className="btn primary"
          onClick={onGenerate}
          disabled={busy || !imagePath || !weightsReady}
        >
          {busy ? '生成中…' : '生成する'}
        </button>
        {progress && (
          <div className="progress">
            <div className="progress-label">
              {progress.state === 'preparing'
                ? '準備中（モデル読込）…'
                : progress.state === 'running'
                  ? `生成中 ${progress.step} / ${progress.total}`
                  : progress.state === 'done'
                    ? '完了'
                    : 'エラー'}
            </div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width:
                    progress.state === 'preparing' || progress.total === 0
                      ? '8%'
                      : `${Math.min(100, Math.round((progress.step / progress.total) * 100))}%`
                }}
              />
            </div>
          </div>
        )}
        {!weightsReady && (
          <div className="hint">
            モデル重み未取得のため生成できません（`hf download VAST-AI/TripoSplat --local-dir
            models/ckpts`）
          </div>
        )}
      </section>

      <section className="panel-section">
        <h2>表示</h2>
        <button className="btn" onClick={onOpenSplat} disabled={busy}>
          .ply / .splat / .spz を開く…
        </button>
        <div className="path">現在の形式: {currentFormat ?? '—'}</div>

        <label className="row">
          <span>背景色</span>
          <input
            type="color"
            value={display.backgroundColor}
            onChange={(e) =>
              onDisplayChange({ ...display, backgroundColor: e.target.value })
            }
          />
        </label>

        <label className="row">
          <span>上下反転 (Y)</span>
          <input
            type="checkbox"
            checked={display.flipY}
            onChange={(e) => onDisplayChange({ ...display, flipY: e.target.checked })}
          />
        </label>

        <label className="row">
          <span>透明度しきい値</span>
          <span className="value">{display.alphaRemovalThreshold}</span>
        </label>
        <input
          type="range"
          min={0}
          max={255}
          step={1}
          value={display.alphaRemovalThreshold}
          onChange={(e) =>
            onDisplayChange({ ...display, alphaRemovalThreshold: Number(e.target.value) })
          }
        />
        <div className="hint">※ しきい値の変更はシーンの再ロードで反映されます</div>
      </section>
    </div>
  )
}
