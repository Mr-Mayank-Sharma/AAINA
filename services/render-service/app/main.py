"""MIRRA render service — internal only, never exposed to the internet directly.

Orchestrates: receive person frame + garment refs → call configured vendor adapter
→ upload result to object storage → return URL.
PRIVACY: the person frame exists only for the duration of this request handler.
It is never written to disk, S3, or any database.
"""
import base64
import os

from fastapi import FastAPI, HTTPException

from app.schemas import HealthOut, RenderIn, RenderOut
from app.storage import upload_render_output
from app.vendors.base import get_vendor

app = FastAPI(title="MIRRA render-service", docs_url=None, redoc_url=None)


@app.get("/internal/health", response_model=HealthOut)
async def health() -> HealthOut:
    return HealthOut()


@app.post("/internal/render", response_model=RenderOut)
async def render(render_in: RenderIn) -> RenderOut:
    vendor_name = os.environ.get("RENDER_VENDOR", "mocked")
    vendor = get_vendor(vendor_name)

    try:
        image_bytes = await vendor.render(
            person_frame_base64=render_in.person_frame_base64,
            garment_image_url=render_in.garment_reference_image_url,
            garment_back_image_url=render_in.garment_reference_back_image_url,
            garment_category=render_in.garment_category,
            body_shape_vector=render_in.body_shape_vector,
        )
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:  # noqa: BLE001 — vendor errors surface as failed renders
        raise HTTPException(status_code=502, detail=f"vendor render failed: {e}")

    output_url = upload_render_output(image_bytes)
    return RenderOut(output_image_url=output_url, vendor_used=vendor.name)
