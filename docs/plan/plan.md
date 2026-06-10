# Image to Splat — プロジェクト計画書

作成日: 2026-06-10 23:47
更新日: 2026-06-10 23:47

## 概要

1 枚の画像から 3D Gaussian Splatting を生成・閲覧・調整できる、研究用途のデスクトップアプリを構築する。生成は [TripoSplat](https://github.com/VAST-AI-Research/TripoSplat)（VAST AI Research, MIT）の推論をアプリ内蔵の Python サイドカーで実行し、表示は Three.js ベースの Gaussian ビューアで行う。配布は想定せず、単一マシンでの研究利用を前提にする。

---

## 技術スタック

| 項目 | 選定 | 備考 |
|------|------|------|
| デスクトップシェル | Electron | WebGL/WebGPU をそのまま使え、ローカルプロセス/ファイル連携が容易 |
| ビルド/開発 | electron-vite + Vite | 高速 HMR、main/preload/renderer を一括管理 |
| UI | React + TypeScript | パラメータパネルの構築に向く |
| 3D 描画 | Three.js | WebGL レンダラ |
| Gaussian 表示 | @mkkellogg/gaussian-splats-3d | `.ply` / `.splat` / `.ksplat` を直接ロード、MIT |
| 推論バックエンド | Python (FastAPI + uvicorn) サイドカー | TripoSplat 推論を実行、localhost HTTP で通信 |
| 推論ライブラリ | PyTorch (cu128 以降) + TripoSplat | Blackwell(sm_120) 対応に cu128 が必須 |
| Python 環境 | venv（同梱、Python 3.11 推奨） | ML エコシステム互換のため 3.11 |

---

## プロジェクト構成（予定）

```
tripo-splat/
├── package.json
├── electron.vite.config.ts
├── tsconfig.json / tsconfig.node.json
├── .gitignore
├── AGENTS.md
├── docs/
│   ├── changelog.md
│   └── plan/{goals,plan,progress}.md
├── src/
│   ├── main/
│   │   └── index.ts          # Electron main: ウィンドウ作成、Python サイドカーの spawn/監視
│   ├── preload/
│   │   └── index.ts          # contextBridge でレンダラに安全な API を公開
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── api.ts        # サイドカー HTTP / IPC 呼び出し
│           └── components/
│               ├── Viewer.tsx      # Three.js + mkkellogg ビューア
│               ├── ParamPanel.tsx  # 生成 + 表示パラメータ
│               └── StatusBar.tsx   # 進捗 / GPU / ログ
├── python/
│   ├── server.py             # FastAPI: /health, /generate, /gpu
│   ├── triposplat_runner.py  # TripoSplat 推論ラッパ（初期は stub）
│   └── requirements.txt
└── models/                   # モデル重み（gitignore 対象、初回取得）
```

---

## 実装フェーズ

### Phase 1: アプリ基盤 + ビューア + サイドカー配線（最初の到達点）

**目標**: アプリが起動し、Python サイドカーが立ち上がり、ローカルの `.ply` / `.splat` をビューアで表示できる。`/generate` はダミー応答で配線確認する。

#### タスク
1. electron-vite + React + TypeScript の雛形（main/preload/renderer）。
2. Electron main で Python サイドカーを spawn し、`/health` を待って ready 判定、終了時に kill。
3. preload で contextBridge による安全な API 公開（サイドカーのポート取得、生成要求など）。
4. Three.js + @mkkellogg/gaussian-splats-3d のビューアコンポーネント（オービットカメラ、背景切替）。
5. ファイル読み込み（D&D / ダイアログ）→ ビューアにロード。
6. パラメータパネル（生成 + 表示）の骨組み。
7. FastAPI サイドカー（`/health`, `/gpu`, stub `/generate`）。

#### 完了条件
- アプリが起動し、サイドカーが ready になる。
- ローカルの `.ply` / `.splat` を読み込んで 3D 表示・カメラ操作できる。
- 表示パラメータ（背景、点スケール等）を調整できる。
- `npm run build` が通る。

---

### Phase 2: TripoSplat 推論の内蔵

**目標**: venv に torch(cu128) と TripoSplat を導入し、画像から実際に Gaussian を生成してビューアに表示する。

#### タスク
1. venv（Python 3.11）構築と torch cu128、TripoSplat 依存の導入。
2. モデル重みの初回取得（Hugging Face）とローカル展開、キャッシュ管理。
3. `triposplat_runner.py` で実推論を実装（画像 + パラメータ → `.ply`）。
4. `/generate` を実推論に接続し、進捗を返す（SSE もしくはポーリング）。
5. 生成結果をビューアへ自動ロード。
6. GPU/CUDA 状態（Blackwell, cu128 整合）を `/gpu` で確認・表示。

#### 完了条件
- アプリ内で画像 → 生成 → 表示が一気通貫で動く。
- 生成パラメータ（ガウシアン数上限など）が結果に反映される。
- GPU 利用が確認できる。

---

### Phase 3: パラメータ拡充とエクスポート

**目標**: 生成・表示パラメータを充実させ、結果を保存できるようにする。

#### タスク
1. 生成パラメータの拡張（シード、ガウシアン数、その他 TripoSplat 入力）。
2. 表示パラメータの拡張（露出/トーン、ソート品質、点スケール、クリッピング）。
3. `.ply` / `.splat` エクスポート。
4. 生成履歴・最近開いたファイルの管理。
5. ログ表示とエラーハンドリングの整理。

---

## Phase 間で共通の設計方針

### プロセス分離
- 推論は必ず Python サイドカーで実行し、Electron 本体（Node/レンダラ）には torch を持ち込まない。
- サイドカーの起動・監視・終了は main プロセスが一元管理する。異常終了時は UI に通知する。

### 通信
- renderer ↔ main は IPC（contextBridge）。
- main/renderer ↔ サイドカーは localhost HTTP（重いバイナリは一時ファイル経由も許容）。
- 生成の進捗は SSE もしくはポーリングで返す。

### セキュリティ/堅牢性
- `contextIsolation: true`、`nodeIntegration: false` を維持し、必要な API だけ preload で公開する。
- サイドカーは固定ポートを避け、空きポートを動的に確保して main に渡す。

### GPU 前提
- 対象 GPU は NVIDIA RTX PRO 5000 Blackwell（sm_120）。torch は cu128 以降。
- 起動時に CUDA 可否と compute capability を確認し、不整合は UI に警告する。

---

## 注意事項

- Blackwell は cu121 などでは動かない（"no kernel image available"）。torch は必ず cu128 以降を入れる。
- Python 3.13 は一部 ML 依存の互換が弱いことがあるため、venv は 3.11 を推奨する。
- モデル重みは大容量。`models/` は gitignore 対象とし、初回取得でローカルに置く。
- 配布は当面考えないため、署名やインストーラ最適化は対象外。
