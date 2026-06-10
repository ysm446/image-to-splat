# Image to Splat

作成日: 2026-06-11 00:10
更新日: 2026-06-11 00:10

1 枚の画像から 3D Gaussian Splatting を生成・閲覧・調整する、研究用途のデスクトップアプリ。
生成は [TripoSplat](https://github.com/VAST-AI-Research/TripoSplat)（VAST AI Research, MIT）の推論をアプリ内蔵の Python サイドカーで実行し、表示は Three.js + [@mkkellogg/gaussian-splats-3d](https://github.com/mkkellogg/GaussianSplats3D) のビューアで行う。

配布は想定せず、単一マシンでの研究利用を前提とする。詳細は `docs/plan/` を参照。

## 構成

- **Electron (main)**: ウィンドウ管理と Python サイドカーの spawn / 監視 / 終了。`src/main/`
- **preload**: contextBridge で安全な API をレンダラへ公開。`src/preload/`
- **Renderer (React + Three.js)**: ビューアとパラメータ UI。`src/renderer/`
- **Python サイドカー (FastAPI)**: `/health` `/gpu` `/file` `/generate`。`python/`

main ↔ renderer は IPC、main/renderer ↔ サイドカーは localhost HTTP。

## 必要環境

- Node.js 18+（確認環境: v24）
- Python 3.11 推奨（ML 依存の互換性のため）
- NVIDIA GPU。本プロジェクトの確認環境は **RTX PRO 5000 Blackwell（sm_120）**
  - Blackwell は **cu128 以降の PyTorch が必須**（cu121 等では動かない）

## セットアップ

### 1. フロントエンド（Phase 1: これだけで起動できる）

```powershell
npm install
npm run dev      # 開発起動（HMR）
# あるいは
npm run build    # 本番ビルド（out/ に出力）
npm run preview  # ビルド済みを起動
```

サイドカーの Python は、`python/.venv` があればそれを、無ければシステム Python を使う。
Phase 1 の `/generate` は stub（未実装応答）。`.ply` / `.splat` の読み込み・表示は動作する。

### 2. 推論バックエンド（Phase 2: TripoSplat 内蔵）

TripoSplat は `transformers` / `diffusers` を使わず torch のみの軽量依存のため、Phase 1 の
`python/.venv`（Python 3.13）をそのまま再利用できる（3.11 環境を別途作る必要はない）。

```powershell
$py = "python\.venv\Scripts\python.exe"
$pip = "python\.venv\Scripts\pip.exe"

# 軽量依存
& $pip install numpy safetensors pillow tqdm huggingface_hub

# PyTorch（Blackwell=cu128 以降。3.13 用 cp313 ホイールが提供される）
& $pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128

# TripoSplat 本体（pip パッケージではないため clone して external/ に置く）
git clone https://github.com/VAST-AI-Research/TripoSplat.git external\TripoSplat

# モデル重み（VAST-AI/TripoSplat）を models/ckpts に取得
& $py -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='VAST-AI/TripoSplat', local_dir=r'models\ckpts')"
```

導入後、`& $py -c "import torch; print(torch.cuda.is_available(), torch.version.cuda)"`
で CUDA 利用可否と cuda バージョン（12.8 以降）を確認する。アプリ起動後はステータスバーにも GPU 情報が出る。

推論は `python/triposplat_runner.py` の `run_inference`（`external/TripoSplat` を `sys.path` に追加して
`TripoSplatPipeline` を構築、`models/ckpts` の重みを使用）が担い、サイドカーの `/generate` から呼ばれる。
重みの有無は `/weights` で確認でき、未取得時はアプリの「生成する」ボタンが無効化される。

## 検証

- フロント/型: `npm run build` と `npm run typecheck`
- Python 構文: `python -m py_compile python/server.py python/triposplat_runner.py`

## ライセンス

MIT
