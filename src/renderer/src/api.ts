// レンダラからサイドカー（FastAPI）への HTTP 呼び出しをまとめる。

let cachedPort = 0

async function port(): Promise<number> {
  if (!cachedPort) cachedPort = await window.api.getSidecarPort()
  return cachedPort
}

export async function base(): Promise<string> {
  return `http://127.0.0.1:${await port()}`
}

/** ローカルファイルをサイドカー経由で配信する URL。ビューアのロードに使う。 */
export async function fileUrl(absPath: string): Promise<string> {
  return `${await base()}/file?path=${encodeURIComponent(absPath)}`
}

export interface GpuInfo {
  torch_available: boolean
  cuda_available: boolean
  device_name?: string
  capability?: string
  torch_version?: string
  cuda_version?: string
  note?: string
}

export async function getGpu(): Promise<GpuInfo> {
  const res = await fetch(`${await base()}/gpu`)
  return res.json()
}

export interface WeightsInfo {
  ready: boolean
  missing: string[]
  note?: string
}

export async function getWeights(): Promise<WeightsInfo> {
  const res = await fetch(`${await base()}/weights`)
  return res.json()
}

export interface GenerateParams {
  imagePath: string
  maxGaussians: number
  seed: number
  steps: number
  guidanceScale: number
}

export interface GenerateResult {
  status: string
  message?: string
  outputPath?: string
}

/** 画像から Gaussian を生成する（Phase 2 で実装、現状は stub）。 */
export async function generate(params: GenerateParams): Promise<GenerateResult> {
  const res = await fetch(`${await base()}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imagePath: params.imagePath,
      maxGaussians: params.maxGaussians,
      seed: params.seed,
      steps: params.steps,
      guidanceScale: params.guidanceScale
    })
  })
  return res.json()
}
