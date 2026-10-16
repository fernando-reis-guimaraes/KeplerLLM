#!/usr/bin/env python3
"""Deterministic KeplerLLM wordmark generator.

Reproduces the AnythingLLM wordmark pattern (infinity mark + NameLLM,
monochrome) with the text swapped to KeplerLLM, using the repo's own
Plus Jakarta Sans variable font.

Reference geometry is measured from the last upstream wordmark assets
(git show 54cad69d^:frontend/public/anything-llm-dark.png, 704x99):
  - canvas 704x99; icon preserved verbatim from the matching variant
    (crop x 0..111, i.e. icon_end=106 plus 5px margin)
  - text drawn with anchor='lt' at text_start=129, orig_top=19
  - dark variant color (34,38,40); light variant pure white
  - 2x wordmark (open-computer, 1396x198): size 172, stroke 4,
    icon_end=209, text_start=257, orig_top=38 (measured upstream)

Rendering recipe (inherited from the validated KeplerLLM rebrand, session
'ses_f32adb7a3ffecN0Q2mp1tH8yxX': PlusJakartaSans Regular at size 86 with
stroke_width=2 -- the look the owner already approved as 'muito bom'.
Only two things changed vs that recipe: the text is monochrome
'KeplerLLM' (AnythingLLM pattern: same color for Name+LLM) instead of
two-color 'Kepler'+blue-'LLM', and the weight comes from the stroke
rather than the Bold variation, so glyph shapes match the approved
assets exactly.

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
SIZE_1X = 86
STROKE_1X = 2
ICON_END_1X = 106
TEXT_X_1X = 129
TEXT_Y_1X = 19  # orig_top
CANVAS_1X = (704, 99)
SIZE_2X = 172
STROKE_2X = 4
ICON_END_2X = 209
TEXT_X_2X = 257
TEXT_Y_2X = 38
CANVAS_2X = (1396, 198)

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
    # Regular weight + stroke (validated recipe); no variation axes.
    return ImageFont.truetype(str(FONT_PATH), size)


def build_wordmark(ref_image: Image.Image, color: tuple, *, size: int,
                   stroke: int, icon_end: int, text_x: int, text_y: int,
                   ) -> Image.Image:
    w, h = ref_image.size
    font = load_font(size)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    # Icon pixels preserved verbatim from the matching upstream variant.
    canvas.alpha_composite(ref_image.crop((0, 0, icon_end + 5, h)), (0, 0))
    tmp = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    full = tmp.textbbox((0, 0), TEXT, font=font, stroke_width=stroke,
                        anchor="lt")
    first = tmp.textbbox((0, 0), TEXT[0], font=font, stroke_width=stroke,
                         anchor="lt")
    draw = ImageDraw.Draw(canvas)
    draw.text((text_x - first[0], text_y - full[1]), TEXT, font=font,
              fill=color, stroke_width=stroke, stroke_fill=color,
              anchor="lt")
    return canvas


def main() -> int:
    ref_dark = git_show_to_image("frontend/public/anything-llm-dark.png")
    ref_light = git_show_to_image("frontend/public/anything-llm-light.png")
    ref_2x = git_show_to_image(
        "open-computer/services/public/anythingllm-wordmark.png")
    assert ref_dark.size == CANVAS_1X, ref_dark.size
    assert ref_2x.size == CANVAS_2X, ref_2x.size

    # Sanity: reference text region must match the documented geometry.
    text_area = ref_dark.crop((129, 0, 704, 99))
    assert text_area.getbbox() == (0, 20, 569, 97), text_area.getbbox()

    dark = build_wordmark(ref_dark, DARK, size=SIZE_1X, stroke=STROKE_1X,
                          icon_end=ICON_END_1X, text_x=TEXT_X_1X,
                          text_y=TEXT_Y_1X)
    light = build_wordmark(ref_light, WHITE, size=SIZE_1X, stroke=STROKE_1X,
                           icon_end=ICON_END_1X, text_x=TEXT_X_1X,
                           text_y=TEXT_Y_1X)
    wordmark = build_wordmark(ref_2x, WHITE, size=SIZE_2X, stroke=STROKE_2X,
                              icon_end=ICON_END_2X, text_x=TEXT_X_2X,
                              text_y=TEXT_Y_2X)

    assert dark.size == CANVAS_1X and light.size == CANVAS_1X
    assert wordmark.size == CANVAS_2X, wordmark.size
    # KeplerLLM (9 chars) renders proportionally narrower than the 11-char
    # upstream text; its right edge must land near x=600 (like its
    # predecessor) so existing CSS layout is preserved.
    right = light.crop((129, 0, 704, 99)).getbbox()[2]
    assert 420 <= right <= 520, right

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
