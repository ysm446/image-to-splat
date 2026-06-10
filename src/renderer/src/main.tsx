import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// ビューア（mkkellogg）の再生成/破棄時に出る既知の無害な拒否を握り潰す。
// シーン切替時の DOM 競合（removeChild）やロード中の dispose（Scene disposed）。
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason instanceof Error ? e.reason.message : String(e.reason ?? '')
  if (msg.includes("removeChild") || msg.includes('Scene disposed')) {
    e.preventDefault()
  }
})

// 命令的な 3D ビューア（生成/破棄）を扱うため、dev の二重マウントによる
// 破棄レース（"Scene disposed" / removeChild）を避けて StrictMode は使わない。
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />)
