import { useEffect, useRef } from 'react'
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'
import * as THREE from 'three'

export type SplatFormat = 'ply' | 'splat' | 'ksplat' | 'spz'

export interface ViewerProps {
  /** ロード対象の URL（サイドカー /file 経由）。null なら何も表示しない。 */
  splatUrl: string | null
  format: SplatFormat
  backgroundColor: string
  /** ロード時に適用する透明度しきい値 (0-255)。変更後はリロードで反映。 */
  alphaRemovalThreshold: number
  /** 上方向を -Y にする（3DGS/SPZ など Y-down データの上下反転対策）。 */
  flipY: boolean
  onLoadingChange?: (loading: boolean) => void
  onError?: (message: string) => void
}

function toSceneFormat(format: SplatFormat): number {
  const F = GaussianSplats3D.SceneFormat
  switch (format) {
    case 'ply':
      return F.Ply
    case 'splat':
      return F.Splat
    case 'ksplat':
      return F.KSplat
    case 'spz':
      return F.Spz
  }
}

export function Viewer(props: ViewerProps): JSX.Element {
  const { splatUrl, format, backgroundColor, alphaRemovalThreshold, flipY, onLoadingChange, onError } =
    props
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<any>(null)

  // splatUrl / format / しきい値が変わるたびにビューアを作り直してロードする。
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false

    async function setup(): Promise<void> {
      // 既存ビューアを破棄
      if (viewerRef.current) {
        try {
          viewerRef.current.dispose()
        } catch {
          /* noop */
        }
        viewerRef.current = null
      }

      const viewer = new GaussianSplats3D.Viewer({
        rootElement: container,
        sharedMemoryForWorkers: false, // COOP/COEP ヘッダ不要にする
        useBuiltInControls: true,
        dynamicScene: false,
        cameraUp: flipY ? [0, -1, 0] : [0, 1, 0],
        initialCameraPosition: [0, 0, 3],
        initialCameraLookAt: [0, 0, 0]
      })
      viewerRef.current = viewer

      // 背景色
      try {
        viewer.renderer?.setClearColor(new THREE.Color(backgroundColor), 1)
      } catch {
        /* バージョン差異は無視 */
      }

      viewer.start()

      if (!splatUrl) return

      onLoadingChange?.(true)
      try {
        await viewer.addSplatScene(splatUrl, {
          format: toSceneFormat(format),
          splatAlphaRemovalThreshold: alphaRemovalThreshold,
          showLoadingUI: false,
          progressiveLoad: false
        })
        if (disposed) return
      } catch (e) {
        onError?.(e instanceof Error ? e.message : String(e))
      } finally {
        onLoadingChange?.(false)
      }
    }

    void setup()

    return () => {
      disposed = true
      if (viewerRef.current) {
        try {
          viewerRef.current.dispose()
        } catch {
          /* noop */
        }
        viewerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splatUrl, format, alphaRemovalThreshold, flipY])

  // 背景色だけの変更はリロードせず反映
  useEffect(() => {
    try {
      viewerRef.current?.renderer?.setClearColor(new THREE.Color(backgroundColor), 1)
    } catch {
      /* noop */
    }
  }, [backgroundColor])

  return <div ref={containerRef} className="viewer-canvas" />
}
