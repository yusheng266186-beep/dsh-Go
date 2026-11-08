#!/usr/bin/env python3
"""Prepare the independent Harness Pocket edition in a disposable checkout."""

import json
import math
from pathlib import Path
import subprocess
import sys

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
ANDROID = APP / "android/app"
RES = ANDROID / "src/main/res"
ASSETS = APP / "assets"
NAME = "Harness Pocket"
UPSTREAM_ID = "io.github.ccch1mneyyy.dsh_app"
APP_ID = "io.github.yusheng266186_beep.harnesspocket"
REPO = "yusheng266186-beep/dsh-Go"

# Original terminal prompt mark in a 108-unit grid.
CHEVRON = [(31, 38), (38, 31), (60, 53), (38, 75), (31, 68), (46, 53)]
CURSOR = [(60, 66), (79, 66), (79, 75), (60, 75)]


def replace(path, old, new):
    data = path.read_text(encoding="utf-8")
    if old in data:
        path.write_text(data.replace(old, new), encoding="utf-8")


def svg_path(points):
    return f"M{points[0][0]} {points[0][1]}" + "".join(
        f"C{x} {y} {x} {y} {x} {y}" for x, y in points[1:] + points[:1]
    ) + "Z"


def write_brand():
    paths = {
        "body": CHEVRON,
        "fin-layer": [(38, 32), (48, 42), (44, 46), (34, 36)],
        "belly-layer": [(44, 57), (48, 61), (38, 71), (34, 67)],
        "bubble-layer": CURSOR,
    }
    for mode, base, bright in (("light", "#3E3491", "#665DE0"), ("dark", "#ACA5FF", "#E2DEFF")):
        ids = ("tail", "fin", "belly", "bubble")
        gradients = "".join(
            f'<radialGradient id="{key}" gradientUnits="userSpaceOnUse" cx="50" cy="45" r="45" '
            'gradientTransform="matrix(1 0 0 1 0 0)">'
            f'<stop offset="0" stop-color="{bright}"/><stop offset="1" stop-color="{base}"/>'
            '</radialGradient>' for key in ids
        )
        shapes = "".join(
            f'<path id="{key}" fill="url(#{fill})" d="{svg_path(points)}"/>'
            for (key, points), fill in zip(paths.items(), ids)
        )
        (ASSETS / f"brand/glyph-{mode}.svg").write_text(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="31 31 48 44">'
            f'<defs>{gradients}</defs>{shapes}</svg>\n', encoding="utf-8"
        )
    mono = "".join(
        f'<path fill="currentColor" d="{svg_path(points)}"/>' for points in (CHEVRON, CURSOR)
    )
    (ASSETS / "brand/glyph-mono.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="31 31 48 44">{mono}</svg>\n',
        encoding="utf-8",
    )
    (ASSETS / "brand/tile.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="18 18 72 72">'
        '<defs><linearGradient id="tile-bg" x1="18" y1="18" x2="90" y2="90">'
        '<stop offset="0" stop-color="#211A51"/><stop offset="1" stop-color="#4A3E8E"/>'
        '</linearGradient></defs>'
        '<path id="tile" fill="url(#tile-bg)" d="M36 18C42 18 66 18 72 18'
        'C82 18 90 26 90 36C90 43 90 65 90 72C90 82 82 90 72 90'
        'C65 90 43 90 36 90C26 90 18 82 18 72C18 65 18 43 18 36'
        'C18 26 26 18 36 18Z"/>'
        f'<g color="#FFFFFF">{mono}</g></svg>\n',
        encoding="utf-8",
    )
    subprocess.run([sys.executable, APP / "tool/make_brand_mark.py"], check=True)


def write_android_icons():
    for file in RES.glob("mipmap-*/ic_launcher*.png"):
        with Image.open(file) as original:
            size = original.width
        background = next(
            (color for style, color in (("night", "#211B46"), ("frost", "#5349A2"), ("ink", "#262735"))
             if style in file.stem),
            "#42368F",
        )
        edge = size * 4
        icon = Image.new("RGBA", (edge, edge))
        draw = ImageDraw.Draw(icon)
        foreground = file.stem.endswith("_foreground")
        if not foreground:
            if file.stem.endswith("_round"):
                draw.ellipse((0, 0, edge - 1, edge - 1), fill=background)
            else:
                draw.rounded_rectangle((0, 0, edge - 1, edge - 1), radius=edge // 5, fill=background)
        scale = edge / (108 if foreground else 78)
        for points in (CHEVRON, CURSOR):
            draw.polygon(
                [(edge / 2 + (x - 54) * scale, edge / 2 + (y - 54) * scale) for x, y in points],
                fill="#FFFFFF",
            )
        icon.resize((size, size), Image.Resampling.LANCZOS).save(file)

    for name, dp, view, points in (
        ("ic_launcher_monochrome", 108, 108, (CHEVRON, CURSOR)),
        ("ic_stat_dsh", 24, 60, tuple([(x - 24, y - 24) for x, y in shape] for shape in (CHEVRON, CURSOR))),
    ):
        paths = "".join(
            f'<path android:fillColor="#FFFFFFFF" android:pathData="{svg_path(shape)}"/>'
            for shape in points
        )
        (RES / f"drawable/{name}.xml").write_text(
            '<vector xmlns:android="http://schemas.android.com/apk/res/android" '
            f'android:width="{dp}dp" android:height="{dp}dp" '
            f'android:viewportWidth="{view}" android:viewportHeight="{view}">{paths}</vector>\n',
            encoding="utf-8",
        )


def robot(width, height, color, phase, sleeping=False):
    image = Image.new("RGBA", (width, height))
    draw = ImageDraw.Draw(image)
    span = min(width, height) * 0.76
    x = (width - span) / 2
    y = (height - span) / 2 + height * 0.08 * math.sin(phase)
    draw.rounded_rectangle((x, y, x + span, y + span), radius=span / 5, fill=color)
    eye_height = span * (0.05 if sleeping else 0.18)
    for eye in (0.29, 0.61):
        left = x + span * eye
        top = y + span * 0.36
        draw.rectangle((left, top, left + span * 0.11, top + eye_height), fill="#FFFFFF")
    draw.rounded_rectangle((x + span * 0.32, y + span * 0.68, x + span * 0.68, y + span * 0.74),
                           radius=span * 0.03, fill="#FFFFFF")
    return image


def write_sprites(path, width, height, columns, count, color, sleeping=False):
    sheet = Image.new("RGBA", (width * columns, height * math.ceil(count / columns)))
    for frame in range(count):
        sprite = robot(width, height, color, math.tau * frame / count, sleeping)
        sheet.paste(sprite, ((frame % columns) * width, (frame // columns) * height))
    sheet.save(path)


def write_art():
    for pack, label, color in (("deepy-whale", "Violet Bot", "#6753BA"),
                               ("whale-girl", "Mint Bot", "#297A78")):
        path = ASSETS / f"pets/{pack}/pack.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        data.update(name=label, author="Harness Pocket", license="AGPL-3.0", source="Original release artwork")
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        for name, animation in data["animations"].items():
            write_sprites(path.with_name(animation["sheet"]), animation["frameW"], animation["frameH"],
                          animation["cols"], max(frame["i"] for frame in animation["frames"]) + 1,
                          color, name == "sleeping")
    path = ASSETS / "whale/whale.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    for level in data["levels"]:
        level["source"] = "Original release artwork"
        write_sprites(path.with_name(level["image"]), data["frameWidth"], data["frameHeight"],
                      data["columns"], level["frames"], "#6753BA")
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    robot(160, 160, "#6753BA", 0).save(ASSETS / "star/star_whale.webp", lossless=True)
    for path in (RES / "drawable-nodpi").glob("companion_widget_*.png"):
        with Image.open(path) as original:
            width, height = original.size
        robot(width, height, "#297A78", 0, "sleeping" in path.stem).save(path)


def prepare():
    if NAME in (ANDROID / "src/main/AndroidManifest.xml").read_text(encoding="utf-8"):
        raise SystemExit("Use a clean disposable checkout")
    for directory in (ANDROID / "src", APP / "lib/dev"):
        for path in directory.rglob("*"):
            if path.suffix in {".kt", ".java", ".xml", ".dart"}:
                replace(path, UPSTREAM_ID, APP_ID)
                replace(path, "DSH Go", NAME)
    replace(ANDROID / "build.gradle.kts", UPSTREAM_ID, APP_ID)
    replace(ANDROID / "proguard-rules.pro", UPSTREAM_ID, APP_ID)
    for path in (APP / "lib/l10n/parts").glob("*.arb"):
        replace(path, "DSH Go", NAME)
    for language, labels in (("zh", ("紫色机器人", "薄荷机器人")), ("en", ("Violet Bot", "Mint Bot"))):
        path = APP / f"lib/l10n/parts/bots_{language}.arb"
        replace(path, '"Deepy 小鲸鱼"' if language == "zh" else '"Deepy"', json.dumps(labels[0], ensure_ascii=False))
        replace(path, '"鲸娘"' if language == "zh" else '"Whale girl"', json.dumps(labels[1], ensure_ascii=False))
    replace(APP / "lib/state/app_info.dart", "static const name = 'DSH Go';", f"static const name = '{NAME}';")
    replace(APP / "lib/state/app_info.dart", "static const wordmark = 'DSH';", "static const wordmark = 'Harness';")
    replace(APP / "lib/update/update_config.dart", "const updateRepo = 'ccch1mneyyy/dsh-go';",
            f"const updateRepo = '{REPO}';")
    # Official public/beta origins are not consulted by the fork.
    replace(APP / "lib/update/update_config.dart", "const updateDownloadOrigin = 'https://dl.dshtui.com';",
            "const updateDownloadOrigin = '';")
    write_brand()
    write_android_icons()
    write_art()
    subprocess.run([sys.executable, APP / "tool/l10n_merge.py"], check=True)


if __name__ == "__main__":
    prepare()
