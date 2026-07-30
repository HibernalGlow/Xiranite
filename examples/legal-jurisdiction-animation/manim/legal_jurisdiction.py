from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from manim import *


CONTENT_PATH = Path(__file__).parents[1] / "src" / "shared" / "legal-jurisdiction.json"
CONTENT: dict[str, Any] = json.loads(CONTENT_PATH.read_text(encoding="utf-8"))
PALETTE = CONTENT["palette"]
FONT_FAMILY = "Microsoft YaHei"
DESIGN_WIDTH = 1920
DESIGN_HEIGHT = 1080


def px_width(value: float) -> float:
    return value / DESIGN_WIDTH * config.frame_width


def px_height(value: float) -> float:
    return value / DESIGN_HEIGHT * config.frame_height


def design_center(geometry: dict[str, float]) -> np.ndarray:
    center_x = geometry["x"] + geometry["width"] / 2
    center_y = geometry["y"] + geometry["height"] / 2
    return np.array(
        [
            (center_x / DESIGN_WIDTH - 0.5) * config.frame_width,
            (0.5 - center_y / DESIGN_HEIGHT) * config.frame_height,
            0,
        ]
    )


def soft_accent(accent: str) -> str:
    if accent == "red":
        return PALETTE["softRed"]
    if accent == "teal":
        return PALETTE["softTeal"]
    return PALETTE["softGold"]


def body_font_size(key: str) -> int:
    if key == "mediation":
        return 18
    if key == "arbitration":
        return 18
    return 20


def make_lines(
    lines: list[str],
    font_size: int,
    max_width: float,
    max_height: float,
    *,
    weight: str = NORMAL,
    color: str = PALETTE["ink"],
    centered: bool = False,
) -> VGroup:
    rendered = VGroup(
        *[
            Text(
                line,
                font=FONT_FAMILY,
                font_size=font_size,
                weight=weight,
                color=color,
            )
            for line in lines
        ]
    )
    if centered:
        rendered.arrange(DOWN, buff=px_height(7))
    else:
        rendered.arrange(DOWN, buff=px_height(7), aligned_edge=LEFT)

    if rendered.width > max_width:
        rendered.scale_to_fit_width(max_width)
    if rendered.height > max_height:
        rendered.scale_to_fit_height(max_height)
    return rendered


def make_cell(
    geometry: dict[str, float],
    lines: list[str],
    *,
    fill: str,
    font_size: int,
    weight: str = NORMAL,
    centered: bool = False,
    accent: str | None = None,
) -> VGroup:
    width = px_width(geometry["width"])
    height = px_height(geometry["height"])
    rectangle = (
        Rectangle(width=width, height=height)
        .set_fill(fill, opacity=1)
        .set_stroke(PALETTE["line"], width=1.4)
        .move_to(design_center(geometry))
    )
    horizontal_padding = px_width(28)
    vertical_padding = px_height(20)
    text = make_lines(
        lines,
        font_size,
        width - 2 * horizontal_padding,
        height - 2 * vertical_padding,
        weight=weight,
        centered=centered,
    )
    text.move_to(rectangle)

    if not centered:
        text.align_to(rectangle.get_left() + RIGHT * horizontal_padding, LEFT)

    if accent is None:
        return VGroup(rectangle, text)

    marker = (
        Square(side_length=px_width(10))
        .set_fill(PALETTE[accent], opacity=1)
        .set_stroke(width=0)
    )
    label = VGroup(marker, text).arrange(RIGHT, buff=px_width(12))
    label.move_to(rectangle)
    return VGroup(rectangle, label)


def table_geometry() -> list[dict[str, dict[str, float]]]:
    table = CONTENT["table"]
    x = table["x"]
    y = table["y"]
    section_width, relation_width, content_width = table["columnWidths"]
    heights = table["rowHeights"]
    tops = [y]
    for height in heights:
        tops.append(tops[-1] + height)

    relationship_height = sum(heights[2:])
    full_content_width = relation_width + content_width
    return [
        {
            "section": {"x": x, "y": tops[0], "width": section_width, "height": heights[0]},
            "content": {
                "x": x + section_width,
                "y": tops[0],
                "width": full_content_width,
                "height": heights[0],
            },
            "focus": {"x": x, "y": tops[0], "width": table["width"], "height": heights[0]},
        },
        {
            "section": {"x": x, "y": tops[1], "width": section_width, "height": heights[1]},
            "content": {
                "x": x + section_width,
                "y": tops[1],
                "width": full_content_width,
                "height": heights[1],
            },
            "focus": {"x": x, "y": tops[1], "width": table["width"], "height": heights[1]},
        },
        {
            "section": {
                "x": x,
                "y": tops[2],
                "width": section_width,
                "height": relationship_height,
            },
            "relation": {
                "x": x + section_width,
                "y": tops[2],
                "width": relation_width,
                "height": heights[2],
            },
            "content": {
                "x": x + section_width + relation_width,
                "y": tops[2],
                "width": content_width,
                "height": heights[2],
            },
            "focus": {
                "x": x + section_width,
                "y": tops[2],
                "width": full_content_width,
                "height": heights[2],
            },
        },
        {
            "relation": {
                "x": x + section_width,
                "y": tops[3],
                "width": relation_width,
                "height": heights[3],
            },
            "content": {
                "x": x + section_width + relation_width,
                "y": tops[3],
                "width": content_width,
                "height": heights[3],
            },
            "focus": {
                "x": x + section_width,
                "y": tops[3],
                "width": full_content_width,
                "height": heights[3],
            },
        },
        {
            "relation": {
                "x": x + section_width,
                "y": tops[4],
                "width": relation_width,
                "height": heights[4],
            },
            "content": {
                "x": x + section_width + relation_width,
                "y": tops[4],
                "width": content_width,
                "height": heights[4],
            },
            "focus": {
                "x": x + section_width,
                "y": tops[4],
                "width": full_content_width,
                "height": heights[4],
            },
        },
    ]


def make_focus(geometry: dict[str, float], accent: str) -> Rectangle:
    return (
        Rectangle(width=px_width(geometry["width"]), height=px_height(geometry["height"]))
        .set_fill(opacity=0)
        .set_stroke(PALETTE[accent], width=4)
        .move_to(design_center(geometry))
    )


class LegalJurisdiction(Scene):
    def construct(self) -> None:
        self.camera.background_color = PALETTE["background"]
        geometry = table_geometry()

        header_accent = (
            Rectangle(width=px_width(12), height=px_height(104))
            .set_fill(PALETTE["red"], opacity=1)
            .set_stroke(width=0)
            .move_to(design_center({"x": 100, "y": 58, "width": 12, "height": 104}))
        )
        eyebrow = Text(
            CONTENT["eyebrow"],
            font=FONT_FAMILY,
            font_size=14,
            weight=BOLD,
            color=PALETTE["red"],
        )
        title = Text(
            CONTENT["title"],
            font=FONT_FAMILY,
            font_size=48,
            weight=BOLD,
            color=PALETTE["ink"],
        )
        header_copy = VGroup(eyebrow, title).arrange(DOWN, buff=px_height(7), aligned_edge=LEFT)
        header_copy.move_to(design_center({"x": 140, "y": 54, "width": 650, "height": 108}))
        header_copy.align_to(
            design_center({"x": 140, "y": 54, "width": 1, "height": 108}), LEFT
        )
        folio = Text(
            CONTENT["folio"],
            font="Arial",
            font_size=14,
            weight=BOLD,
            color=PALETTE["muted"],
        )
        folio.move_to(design_center({"x": 1450, "y": 84, "width": 370, "height": 24}))
        folio.align_to(
            design_center({"x": 1820, "y": 84, "width": 1, "height": 24}), RIGHT
        )

        row_groups: list[VGroup] = []
        for index, row in enumerate(CONTENT["rows"]):
            row_geometry = geometry[index]
            accent = row["accent"]
            cells = VGroup()
            if "section" in row_geometry:
                cells.add(
                    make_cell(
                        row_geometry["section"],
                        row["section"].split("\n"),
                        fill=soft_accent(accent),
                        font_size=17 if index == 2 else 20,
                        weight=BOLD,
                        centered=True,
                        accent=accent,
                    )
                )
            if "relation" in row_geometry:
                cells.add(
                    make_cell(
                        row_geometry["relation"],
                        [row["relation"]],
                        fill=soft_accent(accent),
                        font_size=20,
                        weight=BOLD,
                        centered=True,
                        accent=accent,
                    )
                )
            cells.add(
                make_cell(
                    row_geometry["content"],
                    row["lines"],
                    fill=PALETTE["paper"],
                    font_size=body_font_size(row["key"]),
                    weight=BOLD if row["key"] == "concept" else NORMAL,
                )
            )
            row_groups.append(cells)

        table_bottom = CONTENT["table"]["y"] + sum(CONTENT["table"]["rowHeights"])
        footer_rule = (
            Rectangle(width=px_width(84), height=px_height(4))
            .set_fill(PALETTE["ink"], opacity=1)
            .set_stroke(width=0)
        )
        footer_text = Text(
            "主管 · 人民调解 · 仲裁 · 劳动仲裁",
            font=FONT_FAMILY,
            font_size=17,
            weight=BOLD,
            color=PALETTE["muted"],
        )
        footer = VGroup(footer_rule, footer_text).arrange(RIGHT, buff=px_width(22))
        footer.move_to(
            design_center({"x": 100, "y": table_bottom + 24, "width": 700, "height": 34})
        )
        footer.align_to(
            design_center({"x": 100, "y": table_bottom + 24, "width": 1, "height": 34}), LEFT
        )

        self.play(
            GrowFromCenter(header_accent),
            FadeIn(header_copy, shift=UP * px_height(20)),
            FadeIn(folio),
            run_time=0.8,
            rate_func=smooth,
        )
        self.wait(CONTENT["rowStarts"][0] - 0.8)

        focus = make_focus(geometry[0]["focus"], CONTENT["rows"][0]["accent"])
        self.play(
            FadeIn(row_groups[0], shift=RIGHT * px_width(30)),
            FadeIn(focus),
            run_time=0.55,
            rate_func=smooth,
        )
        self.wait(CONTENT["rowStarts"][1] - CONTENT["rowStarts"][0] - 0.55)

        for index in range(1, len(row_groups)):
            next_focus = make_focus(geometry[index]["focus"], CONTENT["rows"][index]["accent"])
            self.play(
                FadeIn(row_groups[index], shift=RIGHT * px_width(30)),
                Transform(focus, next_focus),
                run_time=0.55,
                rate_func=smooth,
            )
            start = CONTENT["rowStarts"][index]
            next_start = (
                CONTENT["rowStarts"][index + 1]
                if index + 1 < len(CONTENT["rowStarts"])
                else 14.5
            )
            self.wait(max(0, next_start - start - 0.55))

        self.play(
            FadeOut(focus),
            FadeIn(footer, shift=RIGHT * px_width(20)),
            run_time=0.5,
            rate_func=smooth,
        )
        self.wait(CONTENT["durationSeconds"] - 15)
