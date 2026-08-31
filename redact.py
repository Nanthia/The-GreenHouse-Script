#!/usr/bin/env python3
"""Redact identifiable data out of The Green House screenshots.

Fills each sensitive region with the surrounding background colour, then writes
xxxxxxx over it, so the UI still reads as populated rather than looking broken.
"""
from PIL import Image, ImageDraw, ImageFont
import sys, os

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
SRC = "/tmp/shots"
OUT = "/tmp/shots/redacted"
os.makedirs(OUT, exist_ok=True)


def bg_at(im, x, y):
    """Sample a background pixel, for boxes that blend into the panel."""
    return im.convert("RGB").getpixel((x, y))


def redact(im, box, text=None, sample=None, colour=None, size=26, bold=False, align="left"):
    """box = (x1,y1,x2,y2). sample = point to take the fill colour from."""
    d = ImageDraw.Draw(im)
    x1, y1, x2, y2 = box
    fill = bg_at(im, *(sample if sample else (x1 - 6, (y1 + y2) // 2)))
    d.rectangle(box, fill=fill)
    if text:
        f = ImageFont.truetype(FONT_B if bold else FONT, size)
        tb = d.textbbox((0, 0), text, font=f)
        tw, th = tb[2] - tb[0], tb[3] - tb[1]
        ty = y1 + ((y2 - y1) - th) // 2 - tb[1]
        tx = x1 + 4 if align == "left" else x1 + ((x2 - x1) - tw) // 2
        d.text((tx, ty), text, font=f, fill=colour or (200, 195, 215))
    return im


# ---------------------------------------------------------------- Hit Caller
# Player names and IDs in the TARGET column.
im = Image.open(f"{SRC}/03-hitcaller.png").convert("RGB")
NAME_X1, NAME_X2 = 372, 762  # stop short of the LVL column so digits aren't clipped
for yc in (368, 493, 618, 743, 868, 993, 1118, 1243, 1368):
    redact(
        im,
        (NAME_X1, yc - 22, NAME_X2, yc + 18),
        text="xxxxxxx [xxxxxxx]",
        sample=(365, yc),
        colour=(196, 168, 224),
        size=27,
    )
im.save(f"{OUT}/hit-caller.png")
print("hit-caller.png: redacted 9 target names/IDs")

# ---------------------------------------------------------------- Settings
im = Image.open(f"{SRC}/07-settings.png").convert("RGB")
# Input field values: sample from inside the field, away from the text.
fields = [
    ((410, 226, 782, 270), (770, 248)),   # Torn API key
    ((410, 336, 782, 381), (770, 358)),   # Your Torn ID
    ((812, 336, 1186, 381), (1174, 358)), # Torn username
    ((410, 576, 782, 621), (770, 598)),   # My faction ID
    ((812, 576, 1186, 621), (1174, 598)), # Enemy faction ID
]
for box, sample in fields:
    redact(im, box, text="xxxxxxx", sample=sample, colour=(214, 209, 226), size=27)
# "Current enemy: <faction name>" line
redact(
    im,
    (396, 654, 800, 682),
    text="Current enemy: xxxxxxx",
    sample=(390, 668),
    colour=(150, 143, 172),
    size=23,
)
im.save(f"{OUT}/settings.png")
print("settings.png: redacted API key, Torn ID, username, both faction IDs, enemy name")

# ------------------------------------------- Screenshots with nothing to redact
# Chain Manager and Strike Teams are empty states; ATC shows only aggregate
# country counts; the FAB is just the button.
for src, dst in (
    ("05-chain-b.png", "chain-manager.png"),
    ("04-striketeams.png", "strike-teams.png"),
    ("06-atc.png", "air-traffic-control.png"),
    ("02-fab.png", "tgh-button.png"),
):
    Image.open(f"{SRC}/{src}").convert("RGB").save(f"{OUT}/{dst}")
    print(f"{dst}: copied (nothing identifiable)")

print("\nwrote to", OUT)
