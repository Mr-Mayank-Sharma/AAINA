"""Render service schemas — internal contract only (never internet-exposed)."""
from typing import Optional
from pydantic import BaseModel, Field


class RenderIn(BaseModel):
    body_shape_vector: dict = Field(default_factory=dict)
    person_frame_base64: str = Field(..., description="Transient webcam frame; Redis-only, deleted after vendor call")
    garment_reference_image_url: str
    garment_reference_back_image_url: Optional[str] = None
    garment_category: str


class RenderOut(BaseModel):
    output_image_url: str
    vendor_used: str


class HealthOut(BaseModel):
    ok: bool = True
