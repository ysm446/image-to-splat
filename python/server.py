"""Image to Splat の推論サイドカー（FastAPI）。

Electron main から空きポートを渡されて起動する。
- GET  /health   : 起動確認
- GET  /gpu      : torch / CUDA / GPU 情報（Blackwell=cu128 整合の確認用）
- GET  /file     : ローカルファイル配信（ビューアのロード用、ローカル研究用途のみ）
- POST /generate : 画像 -> Gaussian 生成（Phase 2 で実装、現状は stub）
"""

from __future__ import annotations

import argparse
import os
import threading
import uuid

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI(title="Image to Splat Sidecar")

# レンダラ（dev: http://localhost:5173 / 本番: file:// = null オリジン）からの
# クロスオリジン取得を許可する。ローカル単一マシンの研究用途のため全許可で問題ない。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/gpu")
def gpu() -> dict:
    """torch / CUDA の整合を返す。torch 未導入でも 200 を返す。"""
    info: dict = {"torch_available": False, "cuda_available": False}
    try:
        import torch  # noqa: WPS433 (遅延 import)

        info["torch_available"] = True
        info["torch_version"] = torch.__version__
        info["cuda_version"] = getattr(torch.version, "cuda", None)
        info["cuda_available"] = bool(torch.cuda.is_available())
        if info["cuda_available"]:
            info["device_name"] = torch.cuda.get_device_name(0)
            major, minor = torch.cuda.get_device_capability(0)
            info["capability"] = f"{major}.{minor}"
            # Blackwell は sm_120。cu128 未満の torch では動かないため注意喚起。
            if major >= 12 and not (info.get("cuda_version") or "").startswith(("12.8", "12.9", "13")):
                info["note"] = "Blackwell(sm_120) には cu128 以降の torch が必要です"
    except Exception as exc:  # noqa: BLE001
        info["note"] = f"torch 未導入: {exc}"
    return info


@app.get("/file")
def serve_file(path: str) -> FileResponse:
    """ローカルファイルをそのまま返す。ローカル単一マシンの研究用途を前提とする。"""
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="file not found")
    return FileResponse(path)


@app.get("/weights")
def weights() -> dict:
    """モデル重みが揃っているかを返す。"""
    try:
        from triposplat_runner import missing_weights, weights_ready

        return {"ready": weights_ready(), "missing": missing_weights()}
    except Exception as exc:  # noqa: BLE001
        return {"ready": False, "missing": [], "note": str(exc)}


class GenerateRequest(BaseModel):
    imagePath: str
    maxGaussians: int = 65536
    seed: int = 0
    steps: int = 20
    guidanceScale: float = 3.0
    shift: float = 3.0
    removeBg: bool = True


# 生成ジョブの進捗を保持する。フロントは /progress/{jobId} をポーリングする。
# state: preparing（モデル読込など）→ running（サンプリング中）→ done / error
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def _set_job(job_id: str, **kw) -> None:
    with _jobs_lock:
        _jobs.setdefault(job_id, {}).update(kw)


@app.post("/generate")
def generate(req: GenerateRequest) -> dict:
    """生成ジョブを開始し、jobId を返す（非同期）。進捗は /progress/{jobId}。"""
    if not os.path.isfile(req.imagePath):
        raise HTTPException(status_code=400, detail="image not found")

    job_id = uuid.uuid4().hex
    _set_job(
        job_id,
        state="preparing",
        step=0,
        total=req.steps,
        outputPath=None,
        preparedPath=None,
        message=None,
    )

    def worker() -> None:
        try:
            from triposplat_runner import run_inference

            def cb(step: int, total: int) -> None:
                _set_job(job_id, state="running", step=step, total=total)

            result = run_inference(
                req.imagePath,
                req.maxGaussians,
                req.seed,
                steps=req.steps,
                guidance_scale=req.guidanceScale,
                shift=req.shift,
                remove_bg=req.removeBg,
                progress_cb=cb,
            )
            _set_job(
                job_id,
                state="done",
                step=req.steps,
                outputPath=result["plyPath"],
                preparedPath=result["preparedPath"],
            )
        except Exception as exc:  # noqa: BLE001
            _set_job(job_id, state="error", message=str(exc))

    threading.Thread(target=worker, daemon=True).start()
    return {"jobId": job_id}


@app.get("/progress/{job_id}")
def progress(job_id: str) -> dict:
    """生成ジョブの進捗を返す。"""
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return job


class MeshRequest(BaseModel):
    plyPath: str
    resolution: int = 160
    iso: float = 0.25
    opacityMin: float = 0.15
    textureSize: int = 1024


@app.post("/mesh")
def mesh(req: MeshRequest) -> dict:
    """Gaussian .ply のメッシュ化ジョブを開始し、jobId を返す（非同期）。

    進捗は /progress/{jobId}。step はパーセント（total=100）、stage に工程名が入る。
    完了時の outputPath はテクスチャ付き .glb。
    """
    if not os.path.isfile(req.plyPath):
        raise HTTPException(status_code=400, detail="ply not found")

    job_id = uuid.uuid4().hex
    _set_job(job_id, state="preparing", step=0, total=100, stage=None, outputPath=None, message=None)

    def worker() -> None:
        try:
            from mesh_runner import run_meshify

            def cb(percent: int, stage: str) -> None:
                _set_job(job_id, state="running", step=percent, total=100, stage=stage)

            result = run_meshify(
                req.plyPath,
                resolution=req.resolution,
                iso=req.iso,
                opacity_min=req.opacityMin,
                texture_size=req.textureSize,
                progress_cb=cb,
            )
            _set_job(
                job_id,
                state="done",
                step=100,
                outputPath=result["glbPath"],
                message=f"{result['faces']:,} faces",
            )
        except Exception as exc:  # noqa: BLE001
            _set_job(job_id, state="error", message=str(exc))

    threading.Thread(target=worker, daemon=True).start()
    return {"jobId": job_id}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
