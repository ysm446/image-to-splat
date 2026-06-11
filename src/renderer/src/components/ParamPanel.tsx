import type { SplatFormat } from './Viewer'
import type { Progress } from '../api'
import { HelpTip } from './HelpTip'

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
  showGrid: boolean
}

interface ParamPanelProps {
  width: number
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
  /** 生成の経過時間（整形済み文字列） */
  elapsedText: string
}

export function ParamPanel(props: ParamPanelProps): JSX.Element {
  const {
    width,
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
    progress,
    elapsedText
  } = props

  return (
    <div className="panel" style={{ width }}>
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
          <span className="label">
            ガウシアン数 上限
            <HelpTip
              label="ガウシアン数 上限"
              text="生成する3Dガウシアンの最大数。多いほど細部まで再現できますが、生成・表示が重くなります。"
            />
          </span>
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
          <span className="label">
            ステップ数
            <HelpTip
              label="ステップ数"
              text="拡散モデルのサンプリング反復回数。多いほど品質が安定しますが、生成時間が伸びます。"
            />
          </span>
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
          <span className="label">
            ガイダンス強度
            <HelpTip
              label="ガイダンス強度"
              text="入力画像への忠実度。高いほど画像に忠実になりますが、過大だと不自然になりやすくなります。"
            />
          </span>
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
          <span className="label">
            背景除去 (BiRefNet)
            <HelpTip
              label="背景除去"
              text="入力画像から被写体を切り抜いてから生成します。OFF にすると画像全体をそのまま入力します（すでにアルファ付きの画像は元々除去されません）。"
            />
          </span>
          <input
            type="checkbox"
            checked={gen.removeBg}
            onChange={(e) => onGenChange({ ...gen, removeBg: e.target.checked })}
          />
        </label>

        <label className="row">
          <span className="label">
            シード
            <HelpTip
              label="シード"
              text="乱数の初期値。同じ画像・設定・シードであれば、同じ結果を再現できます。"
            />
          </span>
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
              <span>
                {progress.state === 'preparing'
                  ? '準備中（モデル読込）…'
                  : progress.state === 'running'
                    ? `生成中 ${progress.step} / ${progress.total}`
                    : progress.state === 'done'
                      ? '完了'
                      : 'エラー'}
              </span>
              {progress.state !== 'error' && (
                <span className="elapsed">{elapsedText}</span>
              )}
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
            モデル重み未取得のため生成できません（
            <code>hf download VAST-AI/TripoSplat --local-dir models/ckpts</code>）
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
          <span className="label">
            背景色
            <HelpTip
              label="背景色"
              text="ビューアの背景色です。被写体の見え方を確認するための表示設定で、生成結果には影響しません。"
            />
          </span>
          <input
            type="color"
            value={display.backgroundColor}
            onChange={(e) =>
              onDisplayChange({ ...display, backgroundColor: e.target.value })
            }
          />
        </label>

        <label className="row">
          <span className="label">
            上下反転 (Y)
            <HelpTip
              label="上下反転"
              text="表示時に Y 軸を反転します。3DGS/SPZ など Y-down のデータが上下逆さに見える場合に使います。"
            />
          </span>
          <input
            type="checkbox"
            checked={display.flipY}
            onChange={(e) => onDisplayChange({ ...display, flipY: e.target.checked })}
          />
        </label>

        <label className="row">
          <span className="label">
            グリッド表示
            <HelpTip
              label="グリッド表示"
              text="ビューアの原点まわりに基準グリッド（XZ 平面）を表示します。スケールや向きの確認に使えます。生成結果には影響しません。"
            />
          </span>
          <input
            type="checkbox"
            checked={display.showGrid}
            onChange={(e) => onDisplayChange({ ...display, showGrid: e.target.checked })}
          />
        </label>

        <label className="row">
          <span className="label">
            透明度しきい値
            <HelpTip
              label="透明度しきい値"
              text="この値より透明なガウシアンを表示時に除去します。背景まわりのノイズ除去に使います。"
            />
          </span>
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
