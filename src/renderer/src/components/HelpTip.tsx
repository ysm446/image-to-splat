import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface HelpTipProps {
  /** 表示するヘルプ本文 */
  text: string
  /** aria-label 用の項目名 */
  label: string
}

/** ビューポート端からの最小マージン */
const MARGIN = 8
/** アイコンとポップアップの間隔 */
const GAP = 8

/**
 * 項目ラベルの横に置く小さな「?」アイコン。
 * hover / focus で固定配置のポップオーバーを表示する。
 * パネルが overflow: auto でクリップされないよう portal で body 直下に描画し、
 * 描画後に実寸を測ってビューポート内に収まるよう位置をクランプする。
 */
export function HelpTip({ text, label }: HelpTipProps): JSX.Element {
  const iconRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  // 確定するまで描画位置を隠す（測定用の先行描画でのちらつき防止）
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const icon = iconRef.current
    const popup = popupRef.current
    if (!icon || !popup) return

    const a = icon.getBoundingClientRect()
    const p = popup.getBoundingClientRect()
    const winW = window.innerWidth
    const winH = window.innerHeight

    // 水平：アイコン中央を基準に、左右マージン内へクランプ
    const centerX = a.left + a.width / 2
    let left = centerX - p.width / 2
    left = Math.max(MARGIN, Math.min(left, winW - p.width - MARGIN))

    // 垂直：下に収まらなければ上に出す。上下とも収まらなければマージン内へ
    let top = a.bottom + GAP
    if (top + p.height > winH - MARGIN) {
      const above = a.top - GAP - p.height
      top = above >= MARGIN ? above : Math.max(MARGIN, winH - p.height - MARGIN)
    }

    setCoords({ left, top })
  }, [open, text])

  function show(): void {
    setCoords(null)
    setOpen(true)
  }

  function hide(): void {
    setOpen(false)
    setCoords(null)
  }

  return (
    <>
      <button
        ref={iconRef}
        type="button"
        className="help-tip"
        aria-label={`${label}のヘルプ`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        ?
      </button>
      {open &&
        createPortal(
          <div
            ref={popupRef}
            className="help-tip-popup"
            role="tooltip"
            style={{
              left: coords?.left ?? 0,
              top: coords?.top ?? 0,
              visibility: coords ? 'visible' : 'hidden'
            }}
          >
            {text}
          </div>,
          document.body
        )}
    </>
  )
}
