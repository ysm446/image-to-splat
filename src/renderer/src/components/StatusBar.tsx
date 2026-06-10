import type { GpuInfo } from '../api'

interface StatusBarProps {
  ready: boolean
  gpu: GpuInfo | null
  message: string
}

export function StatusBar(props: StatusBarProps): JSX.Element {
  const { ready, gpu, message } = props

  const gpuText = !gpu
    ? 'GPU: 取得中…'
    : gpu.cuda_available
      ? `GPU: ${gpu.device_name ?? 'CUDA'} (cc ${gpu.capability ?? '?'}, torch ${gpu.torch_version ?? '?'} / cu ${gpu.cuda_version ?? '?'})`
      : gpu.torch_available
        ? 'GPU: CUDA 利用不可（CPU フォールバック）'
        : 'GPU: torch 未導入（Phase 2 で導入）'

  return (
    <div className="statusbar">
      <span className={`dot ${ready ? 'ok' : 'wait'}`} />
      <span>{ready ? 'サイドカー稼働中' : 'サイドカー起動待ち…'}</span>
      <span className="sep">|</span>
      <span>{gpuText}</span>
      {message && (
        <>
          <span className="sep">|</span>
          <span className="msg">{message}</span>
        </>
      )}
    </div>
  )
}
