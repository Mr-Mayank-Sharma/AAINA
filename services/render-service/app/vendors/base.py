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
    """Composite renderer: pastes the garment onto the shopper's own photo.

    Proves the async pipeline end-to-end AND gives a personal (if approximate)
    preview — the shopper sees *their* frame wearing the garment. Replaced by
    a real vendor adapter during the bake-off (Step 6).
    """

    name = "mocked"

    # Garment placement as fractions of the person-frame dimensions.
    GARMENT_WIDTH_FRACTION = 0.46
    GARMENT_TOP_FRACTION = 0.20  # chest area

    @staticmethod
    def _knock_out_background(img: "Image.Image", tol: int = 100):
        """Make the studio backdrop transparent via flood-fill from the edges,
        then crop to the garment's bounding box.

        Flood-fill connectivity prevents holes inside the garment; the generous
        tolerance handles vignetted backdrops. Runs on a downscaled copy for
        speed; the upscaled alpha mask doubles as edge feathering.

        Returns (RGBA garment cropped to subject, was_cropped).
        """
        from collections import deque

        from PIL import Image

        rgb = img.convert("RGB")
        W, H = rgb.size
        S = 256
        small = rgb.resize((S, S))
        px = small.load()

        corners = [(0, 0), (S - 1, 0), (0, S - 1), (S - 1, S - 1)]
        cs = [px[c] for c in corners]
        # Median of corners — robust if one corner clips the garment/shadow.
        ref = tuple(sorted(c[i] for c in cs)[1] for i in range(3))

        bg = [[False] * S for _ in range(S)]
        q = deque()
        for cx, cy in corners:
            if not bg[cx][cy]:
                bg[cx][cy] = True
                q.append((cx, cy))
        while q:
            x, y = q.popleft()
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < S and 0 <= ny < S and not bg[nx][ny]:
                    c = px[nx, ny]
                    if abs(c[0] - ref[0]) + abs(c[1] - ref[1]) + abs(c[2] - ref[2]) <= tol * 3:
                        bg[nx][ny] = True
                        q.append((nx, ny))

        mask = Image.new("L", (S, S), 255)
        mp = mask.load()
        cleared = 0
        for x in range(S):
            for y in range(S):
                if bg[x][y]:
                    mp[x, y] = 0
                    cleared += 1
        rgba = img.convert("RGBA")
        if cleared < S * S * 0.02 or cleared > S * S * 0.92:
            # No plausible backdrop found (or everything matched) — leave as-is.
            return rgba, False

        rgba.putalpha(mask.resize((W, H), Image.LANCZOS))
        # Threshold before bbox: LANCZOS ringing leaves faint nonzero alpha
        # far from the subject, which would defeat the crop.
        solid = rgba.getchannel("A").point(lambda a: 255 if a >= 128 else 0)
        bbox = solid.getbbox()
        if bbox:
            rgba = rgba.crop(bbox)
        return rgba, True

    async def render(
        self,
        person_frame_base64: str,
        garment_image_url: str,
        garment_back_image_url: Optional[str],
        garment_category: str,
        body_shape_vector: dict,
    ) -> bytes:
        import asyncio
        from io import BytesIO
        from base64 import b64decode
        from PIL import Image

        def _composite() -> bytes:
            person = Image.open(BytesIO(b64decode(person_frame_base64))).convert("RGB")
            pw, ph = person.size

            # Fetch garment image.
            with httpx.Client(timeout=30) as client:
                resp = client.get(garment_image_url)
                resp.raise_for_status()
            garment = Image.open(BytesIO(resp.content))

            # Opaque product photos: remove the studio backdrop first.
            if garment.mode not in ("RGBA", "LA") or (garment.mode == "RGBA" and garment.getextrema()[3][0] == 255):
                garment, _ = self._knock_out_background(garment)
            else:
                garment = garment.convert("RGBA")

            # Scale garment to torso width and center it on the chest area.
            gw = int(pw * self.GARMENT_WIDTH_FRACTION)
            gh = int(garment.height * (gw / garment.width))
            garment = garment.resize((gw, gh), Image.LANCZOS)

            x = (pw - gw) // 2
            y = int(ph * self.GARMENT_TOP_FRACTION)
            person.paste(garment, (x, y), garment)  # alpha mask keeps transparency

            out = BytesIO()
            person.save(out, format="JPEG", quality=88)
            return out.getvalue()

        # PIL is CPU-bound — keep the event loop responsive.
        return await asyncio.to_thread(_composite)


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
