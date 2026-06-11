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
  /** splat メッシュを上下反転する（3DGS/SPZ など Y-down データ対策。ギズモ/カメラは反転しない）。 */
  flipY: boolean
  /** ビューアの基準グリッドを表示する。 */
  showGrid: boolean
  /** 各スプラットを点（スクリーン空間の円）として描画する。 */
  pointCloud: boolean
  onLoadingChange?: (loading: boolean) => void
  onError?: (message: string) => void
}

/** 軸ラベル（X/Y/Z）のスプライトを生成する。 */
function makeAxisLabel(text: string, color: string): THREE.Sprite {
  const px = 64
  const canvas = document.createElement('canvas')
  canvas.width = px
  canvas.height = px
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color
  ctx.font = 'bold 44px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, px / 2, px / 2)
  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.LinearFilter
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
  return new THREE.Sprite(mat)
}

/** 左下に表示する軸ギズモ（X赤 / Y緑＝縦 / Z青）のシーンを組み立てる。 */
function buildGizmoScene(): THREE.Scene {
  const scene = new THREE.Scene()
  const len = 0.8
  const axes: Array<[THREE.Vector3, number, string, string]> = [
    [new THREE.Vector3(1, 0, 0), 0xff5555, 'X', '#ff8080'],
    [new THREE.Vector3(0, 1, 0), 0x55dd55, 'Y', '#88ee88'],
    [new THREE.Vector3(0, 0, 1), 0x5599ff, 'Z', '#88bbff']
  ]
  for (const [dir, color, label, css] of axes) {
    const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(), len, color, 0.22, 0.13)
    scene.add(arrow)
    const sprite = makeAxisLabel(label, css)
    sprite.position.copy(dir.clone().multiplyScalar(len + 0.22))
    sprite.scale.setScalar(0.3)
    scene.add(sprite)
  }
  return scene
}

/** ギズモシーンの GPU リソースを解放する。 */
function disposeGizmoScene(scene: THREE.Scene): void {
  scene.traverse((obj) => {
    const anyObj = obj as unknown as {
      dispose?: () => void
      geometry?: THREE.BufferGeometry
      material?: THREE.Material | THREE.Material[]
    }
    if (typeof anyObj.dispose === 'function') anyObj.dispose()
    anyObj.geometry?.dispose()
    const mats = anyObj.material
    for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      const map = (m as THREE.SpriteMaterial).map
      map?.dispose()
      m.dispose()
    }
  })
}

/** 基準グリッド（XZ 平面）を生成する。 */
function makeGrid(): THREE.GridHelper {
  const grid = new THREE.GridHelper(10, 20, 0x6a9dff, 0x3a3a40)
  // 半透明にして splat の邪魔をしすぎないようにする
  const mat = grid.material as THREE.Material | THREE.Material[]
  for (const m of Array.isArray(mat) ? mat : [mat]) {
    m.transparent = true
    m.opacity = 0.5
    m.depthWrite = false
  }
  grid.renderOrder = -1
  return grid
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
  const {
    splatUrl,
    format,
    backgroundColor,
    alphaRemovalThreshold,
    flipY,
    showGrid,
    pointCloud,
    onLoadingChange,
    onError
  } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<any>(null)
  const gridRef = useRef<THREE.GridHelper | null>(null)
  const gizmoCleanupRef = useRef<(() => void) | null>(null)

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
        cameraUp: [0, 1, 0], // カメラ（＝ギズモ）は常に Y-up。反転は splat 側で行う
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

      // 中ボタンドラッグをパンに割り当てる（既定はドリー）
      try {
        for (const c of [viewer.controls, viewer.perspectiveControls, viewer.orthographicControls]) {
          if (c?.mouseButtons) c.mouseButtons.MIDDLE = THREE.MOUSE.PAN
        }
      } catch {
        /* controls 構成の差異は無視 */
      }

      // 基準グリッドをシーンに追加（表示/非表示は別 effect で切替）
      try {
        const grid = makeGrid()
        grid.visible = showGrid
        viewer.threeScene?.add(grid)
        gridRef.current = grid
      } catch {
        /* threeScene 非公開なバージョンは無視 */
      }

      // 左下に軸ギズモを重ねる（メインカメラの姿勢に毎フレーム同期）
      try {
        const SIZE = 100
        const canvas = document.createElement('canvas')
        canvas.className = 'gizmo-overlay'
        container?.appendChild(canvas)

        const gizmoRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
        gizmoRenderer.setPixelRatio(window.devicePixelRatio)
        gizmoRenderer.setSize(SIZE, SIZE, false)

        const gizmoScene = buildGizmoScene()
        const gizmoCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 10)
        const forward = new THREE.Vector3()
        let raf = 0

        const tick = (): void => {
          const main = viewerRef.current?.camera as THREE.Camera | undefined
          if (main) {
            // メインカメラの回転（roll や up 反転含む）をそのまま反映し、原点を正面に置く
            gizmoCamera.quaternion.copy(main.quaternion)
            forward.set(0, 0, -1).applyQuaternion(gizmoCamera.quaternion)
            gizmoCamera.position.copy(forward.multiplyScalar(-3))
          }
          gizmoRenderer.render(gizmoScene, gizmoCamera)
          raf = requestAnimationFrame(tick)
        }
        tick()

        gizmoCleanupRef.current = () => {
          cancelAnimationFrame(raf)
          disposeGizmoScene(gizmoScene)
          gizmoRenderer.dispose()
          canvas.remove()
        }
      } catch {
        /* ギズモは補助表示なので失敗しても続行 */
      }

      if (!splatUrl) return

      onLoadingChange?.(true)
      try {
        await viewer.addSplatScene(splatUrl, {
          format: toSceneFormat(format),
          splatAlphaRemovalThreshold: alphaRemovalThreshold,
          // 上下反転は splat メッシュを Z 軸まわりに 180°回転して実現（ギズモは反転しない）
          rotation: flipY ? [0, 0, 1, 0] : undefined,
          showLoadingUI: false,
          progressiveLoad: false
        })
        if (disposed) return
        // ロード後に現在の表示モードを反映
        try {
          viewer.splatMesh?.setPointCloudModeEnabled(pointCloud)
        } catch {
          /* noop */
        }
      } catch (e) {
        onError?.(e instanceof Error ? e.message : String(e))
      } finally {
        onLoadingChange?.(false)
      }
    }

    void setup()

    return () => {
      disposed = true
      gridRef.current = null
      if (gizmoCleanupRef.current) {
        gizmoCleanupRef.current()
        gizmoCleanupRef.current = null
      }
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

  // グリッドの表示/非表示はリロードせず反映
  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = showGrid
  }, [showGrid])

  // 表示モード（スプラット / ポイントクラウド）はリロードせず反映
  useEffect(() => {
    try {
      viewerRef.current?.splatMesh?.setPointCloudModeEnabled(pointCloud)
    } catch {
      /* noop */
    }
  }, [pointCloud])

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
