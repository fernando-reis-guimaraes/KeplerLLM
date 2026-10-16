#!/usr/bin/env python3
"""Deterministic KeplerLLM wordmark generator.

Reproduces the AnythingLLM wordmark pattern (infinity mark + NameLLM,
monochrome) with the text swapped to KeplerLLM, using the repo's own
Plus Jakarta Sans variable font.

Reference geometry is measured from the last upstream wordmark assets
(git show 54cad69d^:frontend/public/anything-llm-dark.png, 704x99):
  - canvas 704x99, icon occupies x 0..105, 24px gap, text starts x=130
  - text bbox y 20..97 (cap height ~77px incl. descenders of 'y'/'g')
  - dark variant color (34,38,40); light variant pure white
  - 2x wordmark (open-computer) is exactly 1396x198, same layout scaled 2x

Calibration: at PlusJakartaSans Bold size 78 the reference string
'AnythingLLM' renders 558px wide; TRACK_1X pads it to exactly 568px
(the original text width). The same size/tracking renders 'KeplerLLM'
proportionally narrower (~same footprint as the previous Kepler wordmark,
ending near x=600 on the 704px canvas, which keeps existing CSS layout).

Outputs (3 distinct pixel contents, copied to all 11 branded paths):
  - dark text  -> *-dark.png, *-invert.png
  - white text -> *-light.png, *.png (plain)
  - white text 2x -> keplerllm-wordmark.png

Icon-only assets (kepler-llm-icon.png, kepler-llm-infinity.png) contain no
text and are intentionally left untouched.

Determinism: no timestamps, no randomness; PNG saved with default
encoder settings. Re-running on the same Pillow version yields
byte-identical files (hashes printed at the end).

Requires: Pillow (pip install pillow). Run from repo root:
  python3 tools/generate-kepler-wordmark.py
"""

import hashlib
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT_PATH = ROOT / "frontend/public/fonts/PlusJakartaSans.ttf"
REF_COMMIT = "54cad69d^"  # last upstream (AnythingLLM) wordmark assets

TEXT = "KeplerLLM"
REFERENCE_TEXT = "AnythingLLM"  # used only to calibrate tracking
WEIGHT = 700  # Bold
SIZE_1X = 78
TEXT_X_1X = 130
TEXT_Y_1X = 20
CANVAS_1X = (704, 99)
SCALE_2X = 2

DARK = (34, 38, 40, 255)
WHITE = (255, 255, 255, 255)

# Path groups share identical pixels (matches pre-existing layout).
DARK_TEXT_PATHS = [
    "frontend/public/kepler-llm-dark.png",
    "frontend/src/media/logo/kepler-llm-dark.png",
    "server/storage/assets/kepler-llm-invert.png",
    "server/utils/agents/aibitat/plugins/create-files/assets/kepler-llm-invert.png",
]
LIGHT_TEXT_PATHS = [
    "frontend/public/kepler-llm-light.png",
    "frontend/src/media/logo/kepler-llm.png",
    "server/storage/assets/kepler-llm.png",
    "server/utils/agents/aibitat/plugins/create-files/assets/kepler-llm.png",
]
WORDMARK_2X_PATH = "open-computer/services/public/keplerllm-wordmark.png"


def git_show_to_image(ref_path: str) -> Image.Image:
    data = subprocess.check_output(
        ["git", "-C", str(ROOT), "show", f"{REF_COMMIT}:{ref_path}"]
    )
    import io

    return Image.open(io.BytesIO(data)).convert("RGBA")


def load_font(size: int) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(FONT_PATH), size)
    font.set_variation_by_axes([WEIGHT])
    return font


def calibrate_tracking(font: ImageFont.FreeTypeFont, target_width: int) -> float:
    widths = [font.getlength(c) for c in REFERENCE_TEXT]
    return (target_width - sum(widths)) / (len(REFERENCE_TEXT) - 1)


def render_text(text: str, font: ImageFont.FreeTypeFont, track: float,
                color: tuple) -> Image.Image:
    widths = [font.getlength(c) for c in text]
    total = int(round(sum(widths) + track * (len(text) - 1)))
    ascent, descent = font.getmetrics()
    img = Image.new("RGBA", (total + 40, ascent + descent + 40), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    x = 20.0
    for ch, w in zip(text, widths):
        draw.text((x, 20), ch, font=font, fill=color)
        x += w + track
    bbox = img.getbbox()
    assert bbox, "rendered text is empty"
    return img.crop(bbox)


def recolor_alpha(alpha_source: Image.Image, color: tuple) -> Image.Image:
    """Keep the reference alpha channel, paint it with a flat color."""
    solid = Image.new("RGBA", alpha_source.size, color)
    solid.putalpha(alpha_source.split()[3])
    return solid


def build_wordmark(ref_dark: Image.Image, ref_2x: Image.Image,
                   color: tuple, scale: int) -> Image.Image:
    if scale == 1:
        ref, size, tx, ty = ref_dark, SIZE_1X, TEXT_X_1X, TEXT_Y_1X
        canvas_size = CANVAS_1X
        target_width = 568  # measured original 'AnythingLLM' text width
        icon = ref.crop((0, 0, 130, ref.size[1]))
    else:
        # NOTE: the 2x asset is not exactly 2x the 1x canvas (1396 vs 1408
        # wide); geometry below is measured from the upstream 2x asset.
        ref, size = ref_2x, SIZE_1X * SCALE_2X
        tx, ty = 260, 42
        canvas_size = (1396, 198)
        target_width = 1123  # measured original 'AnythingLLM' text width
        icon = ref.crop((0, 0, 260, ref.size[1]))
    font = load_font(size)
    track = calibrate_tracking(font, target_width)
    text = render_text(TEXT, font, track, color)
    canvas = Image.new("RGBA", canvas_size, (0, 0, 0, 0))
    canvas.alpha_composite(recolor_alpha(icon, color), (0, 0))
    canvas.alpha_composite(text, (tx, ty))
    return canvas


def main() -> int:
    ref_dark = git_show_to_image("frontend/public/anything-llm-dark.png")
    ref_2x = git_show_to_image(
        "open-computer/services/public/anythingllm-wordmark.png")
    assert ref_dark.size == CANVAS_1X, ref_dark.size
    assert ref_2x.size == (1396, 198), ref_2x.size

    # Sanity: reference text region must match the documented geometry.
    text_area = ref_dark.crop((130, 0, 704, 99))
    assert text_area.getbbox() == (0, 20, 568, 97), text_area.getbbox()

    dark = build_wordmark(ref_dark, ref_2x, DARK, scale=1)
    light = build_wordmark(ref_dark, ref_2x, WHITE, scale=1)
    wordmark = build_wordmark(ref_dark, ref_2x, WHITE, scale=SCALE_2X)

    assert dark.size == CANVAS_1X and light.size == CANVAS_1X
    assert wordmark.size == (1396, 198), wordmark.size
    # KeplerLLM (9 chars) renders proportionally narrower than the 11-char
    # reference; its right edge must land near x=600 (bbox is crop-relative).
    right = light.crop((130, 0, 704, 99)).getbbox()[2]
    assert 430 <= right <= 510, right

    for rel in DARK_TEXT_PATHS:
        dark.save(ROOT / rel)
    for rel in LIGHT_TEXT_PATHS:
        light.save(ROOT / rel)
    wordmark.save(ROOT / WORDMARK_2X_PATH)

    for rel in DARK_TEXT_PATHS + LIGHT_TEXT_PATHS + [WORDMARK_2X_PATH]:
        data = (ROOT / rel).read_bytes()
        print(f"{hashlib.md5(data).hexdigest()}  {rel}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
