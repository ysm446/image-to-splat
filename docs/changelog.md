# Changelog

Image to Splat の変更履歴。日時は `YYYY-MM-DD HH:MM` 形式で書く。

## 未リリース

- アプリ名を「TripoSplat Studio」から「Image to Splat」へ変更しました（パッケージ名 `image-to-splat`）。モデル非依存で用途が明確な名前にし、公式 Tripo ブランドとの混同を避けるため。フォルダ名 `tripo-splat` は維持。なおモデル本体の「TripoSplat」表記（`external/TripoSplat`、`TripoSplatPipeline` 等）はそのまま。

### Phase 2: TripoSplat 推論の内蔵

- 既存 venv(3.13) に torch 2.11.0+cu128 と TripoSplat 軽量依存（numpy/safetensors/pillow/tqdm/huggingface_hub）を導入しました。CUDA 12.8 / RTX PRO 5000 Blackwell(sm_120) で `cuda.is_available()=True` を確認。
- TripoSplat 本体を `external/TripoSplat` にクローンし、モデル重み（約3.5GB、5ファイル）を `models/ckpts` に取得しました。
- `triposplat_runner.run_inference` を実装し、`TripoSplatPipeline` を遅延シングルトンで構築、画像→Gaussian を生成して `outputs/` に `.ply` 保存します。
- サイドカーに `/weights`（重み有無）を追加し、`/generate` を実推論へ接続（steps/guidance/shift 対応）。stub を廃止。
- 生成 UI にステップ数・ガイダンス強度スライダーを追加。重み未取得時は「生成する」を無効化。
- ランナー単体検証: サンプル画像から 32768 ガウシアンの `.ply` を約12.9秒（初回・重みロード込み）で生成し、標準 3DGS PLY であることを確認。

### Phase 1

- プロジェクトを Image to Splat として再定義し、別プロジェクト（Road Editor）由来の docs / .gitignore を作り直しました。
- electron-vite + React + TypeScript の雛形を追加しました。
- Three.js + @mkkellogg/gaussian-splats-3d による Gaussian ビューア（`.ply` / `.splat` 読み込み、オービットカメラ、背景・点スケール調整）を追加しました。
- Python サイドカー（FastAPI: `/health`, `/gpu`, stub `/generate`）と、Electron main 側の spawn / `/health` 待ち / 終了処理を追加しました。
- 起動スクリプト `start.bat` を追加しました（引数なしで開発起動、`build` で本番ビルド起動。初回は npm install を自動実行）。`ELECTRON_RUN_AS_NODE` をクリアし、環境変数が設定済みでも GUI として起動するようにしました。
- 実機で GUI 起動とサイドカー（`/health` `/gpu` `/file` stub `/generate`）の動作を確認しました。サイドカー用の軽量 venv（fastapi/uvicorn、torch なし）で検証。
- ビューアの対応形式に `.spz`（Niantic の圧縮 Gaussian 形式）を追加しました（ファイルダイアログ、拡張子判定、形式マッピング）。
- 単一インスタンスロック（`app.requestSingleInstanceLock()`）を追加しました。多重起動による userData キャッシュの競合（`Unable to move/create the cache`, アクセス拒否 0x5）を防ぎます。
- `second-instance` ハンドラで破棄済みウィンドウを参照して `TypeError: Object has been destroyed` で落ちる不具合を修正しました（`isDestroyed()` チェックと、ウィンドウ `closed` 時の `mainWindow = null` 化）。
- サイドカー（FastAPI）に CORS ミドルウェアを追加しました。レンダラ（dev: localhost:5173 / 本番: file://）からの `/gpu` `/generate` `/file` 取得が CORS でブロックされる問題を解消します。
- CSP に `'wasm-unsafe-eval'` を追加し、mkkellogg の WebAssembly（ソート/SPZ デコード）が `script-src 'self'` でブロックされて描画できない問題を解消しました。
- React.StrictMode を外し、dev の二重マウントによるビューア破棄レース（`Scene disposed` / `removeChild`）を回避しました。残る既知の無害な破棄系拒否はグローバルの `unhandledrejection` で握り潰します。
- 表示に「上下反転 (Y)」トグルを追加しました（`cameraUp` の +Y/-Y 切替）。3DGS/SPZ など Y-down データの上下反転に対応。既定はON。
- 実機で SPZ ファイルの読み込み・3D 表示を確認しました（ビューア描画の動作確認完了）。
