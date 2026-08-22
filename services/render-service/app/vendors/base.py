"""TryOnVendor adapter interface (Decision D5) + mocked renderer.

All vendors conform to the same signature so the pilot bake-off can swap
adapters per test batch without touching any other service.
"""
import abc
from typing import Optional

import httpx


class TryOnVendor(abc.ABC):
    name: str

    @abc.abstractmethod
    async def render(
        self,
        person_frame_base64: str,
        garment_image_url: str,
        garment_back_image_url: Optional[str],
        garment_category: str,
        body_shape_vector: dict,
    ) -> bytes:
        """Return rendered try-on image bytes."""


class MockedVendor(TryOnVendor):
    """Fake renderer: proves the async pipeline end-to-end before any real vendor.

    Returns the garment reference image bytes unchanged (acts as the placeholder).
    """

    name = "mocked"

    async def render(
        self,
        person_frame_base64: str,
        garment_image_url: str,
        garment_back_image_url: Optional[str],
        garment_category: str,
        body_shape_vector: dict,
    ) -> bytes:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(garment_image_url)
            resp.raise_for_status()
            return resp.content


class FashnAdapter(TryOnVendor):
    """FASHN hosted try-on API. Primary candidate (Decision D5).

    NOTE: endpoint/params to be finalized against FASHN docs during Step 6 bake-off.
    """

    name = "fashn"

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    async def render(
        self,
        person_frame_base64: str,
        garment_image_url: str,
        garment_back_image_url: Optional[str],
        garment_category: str,
        body_shape_vector: dict,
    ) -> bytes:
        raise NotImplementedError("Finalize against FASHN docs during vendor bake-off (Step 6)")


class KlingKolorsAdapter(TryOnVendor):
    name = "kling_kolors"

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    async def render(
        self,
        person_frame_base64: str,
        garment_image_url: str,
        garment_back_image_url: Optional[str],
        garment_category: str,
        body_shape_vector: dict,
    ) -> bytes:
        raise NotImplementedError("Finalize during vendor bake-off (Step 6)")


class VeesualAdapter(TryOnVendor):
    """Veesual composites real garment photos (AI handles lighting/alignment only)."""

    name = "veesual"

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    async def render(
        self,
        person_frame_base64: str,
        garment_image_url: str,
        garment_back_image_url: Optional[str],
        garment_category: str,
        body_shape_vector: dict,
    ) -> bytes:
        raise NotImplementedError("Finalize during vendor bake-off (Step 6)")


def get_vendor(name: str) -> TryOnVendor:
    import os

    if name == "mocked":
        return MockedVendor()
    if name == "fashn":
        return FashnAdapter(os.environ["FASHN_API_KEY"])
    if name == "kling_kolors":
        return KlingKolorsAdapter(os.environ["KLING_API_KEY"])
    if name == "veesual":
        return VeesualAdapter(os.environ["VEESUAL_API_KEY"])
    raise ValueError(f"unknown vendor: {name}")
