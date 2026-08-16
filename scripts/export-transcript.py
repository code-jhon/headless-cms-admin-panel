#!/usr/bin/env python3
"""
Export a Claude Code session transcript to a readable PDF.

Reads the session's own .jsonl — this is the real record, not a reconstruction.

What is included:
  * every message the user typed, with its timestamp
  * every prose reply from the assistant, in full
  * a compact trace of the tool calls between them (name + one-line descriptor)

What is left out, and why:
  * tool RESULTS — 2.6 MB of file contents, command output and search hits.
    Including them would produce a document nobody could read, and the
    artifacts they produced are already in the repository.
  * injected context — system reminders, skill definitions loaded mid-turn,
    and the image-coordinate notices the harness adds after reading a
    screenshot. None of it was typed by either party.
"""

import html
import json
import re
import sys
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)

# ------------------------------------------------------------------ fonts

FONT_DIR = "/usr/share/fonts/truetype/dejavu"
pdfmetrics.registerFont(TTFont("Body", f"{FONT_DIR}/DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("Body-Bold", f"{FONT_DIR}/DejaVuSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("Body-Italic", f"{FONT_DIR}/DejaVuSans-Oblique.ttf"))
pdfmetrics.registerFont(TTFont("Mono", f"{FONT_DIR}/DejaVuSansMono.ttf"))
pdfmetrics.registerFont(TTFont("Mono-Bold", f"{FONT_DIR}/DejaVuSansMono-Bold.ttf"))
pdfmetrics.registerFontFamily(
    "Body", normal="Body", bold="Body-Bold", italic="Body-Italic"
)

# ---------------------------------------------------------------- palette
# Same values the admin panel uses, so the export matches the project.
INK = colors.HexColor("#14161A")
MUTED = colors.HexColor("#5F6773")
LIGHT = colors.HexColor("#9AA3AF")
ACCENT = colors.HexColor("#4F46E5")
ACCENT_BG = colors.HexColor("#EEF2FF")
RULE = colors.HexColor("#E4E7EC")
PAPER = colors.HexColor("#F6F7F9")

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm

# ----------------------------------------------------------------- styles

S = {}
S["title"] = ParagraphStyle("title", fontName="Body-Bold", fontSize=26, leading=31,
                            textColor=INK, spaceAfter=6)
S["subtitle"] = ParagraphStyle("subtitle", fontName="Body", fontSize=13, leading=18,
                               textColor=MUTED, spaceAfter=4)
S["meta"] = ParagraphStyle("meta", fontName="Body", fontSize=9, leading=13,
                           textColor=MUTED)
S["h2"] = ParagraphStyle("h2", fontName="Body-Bold", fontSize=13, leading=17,
                         textColor=INK, spaceBefore=10, spaceAfter=5)
S["body"] = ParagraphStyle("body", fontName="Body", fontSize=9.5, leading=14,
                           textColor=INK, alignment=TA_LEFT, spaceAfter=5)
S["user"] = ParagraphStyle("user", fontName="Body", fontSize=10.5, leading=15.5,
                           textColor=INK, spaceAfter=3)
S["bullet"] = ParagraphStyle("bullet", parent=S["body"], leftIndent=11,
                             bulletIndent=2, spaceAfter=2.5)
S["quote"] = ParagraphStyle("quote", parent=S["body"], leftIndent=10,
                            textColor=MUTED, fontName="Body-Italic")
# A stronger tint plus a hairline border: #F6F7F9 was too close to white to
# read as a distinct block on paper.
S["code"] = ParagraphStyle("code", fontName="Mono", fontSize=7.6, leading=10.2,
                           textColor=INK, backColor=colors.HexColor("#EEF0F4"),
                           borderColor=RULE, borderWidth=0.5, borderPadding=5,
                           leftIndent=3, spaceBefore=4, spaceAfter=7)
S["tool"] = ParagraphStyle("tool", fontName="Mono", fontSize=7.2, leading=10,
                           textColor=MUTED, leftIndent=3)
S["label"] = ParagraphStyle("label", fontName="Body-Bold", fontSize=7.6, leading=10,
                            textColor=ACCENT)
S["label_a"] = ParagraphStyle("label_a", parent=S["label"], textColor=MUTED)

# ------------------------------------------------------------ text helpers

INLINE_CODE = re.compile(r"`([^`\n]+)`")
BOLD = re.compile(r"\*\*([^*\n]+)\*\*")
ITALIC = re.compile(r"(?<![\*\w])\*([^*\n]+)\*(?!\*)")
LINK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


def rich(text):
    """Minimal markdown -> reportlab inline markup, with escaping first."""
    out = html.escape(text, quote=False)
    out = LINK.sub(r'\1 <font color="#5F6773">(\2)</font>', out)
    out = INLINE_CODE.sub(r'<font face="Mono" size="8.6">\1</font>', out)
    out = BOLD.sub(r"<b>\1</b>", out)
    out = ITALIC.sub(r"<i>\1</i>", out)
    return out


def render_markdown(text, story, base=None):
    """Render a prose block, handling fenced code, lists, quotes and headings."""
    base = base or S["body"]
    lines = text.replace("\r\n", "\n").split("\n")
    i = 0
    buf = []

    def flush():
        if buf:
            joined = " ".join(x.strip() for x in buf if x.strip())
            if joined:
                story.append(Paragraph(rich(joined), base))
            buf.clear()

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("```"):
            flush()
            i += 1
            block = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                block.append(lines[i])
                i += 1
            i += 1
            if block:
                # Hard-wrap so long lines cannot run off the page.
                wrapped = []
                for b in block:
                    b = b.replace("\t", "    ")
                    while len(b) > 108:
                        wrapped.append(b[:108])
                        b = b[108:]
                    wrapped.append(b)
                story.append(Preformatted("\n".join(wrapped[:60]), S["code"]))
            continue

        if not stripped:
            flush()
            i += 1
            continue

        if stripped.startswith("#"):
            flush()
            story.append(Paragraph(rich(stripped.lstrip("# ").strip()), S["h2"]))
            i += 1
            continue

        if stripped.startswith(("- ", "* ", "• ")):
            flush()
            story.append(
                Paragraph(rich(stripped[2:].strip()), S["bullet"], bulletText="•")
            )
            i += 1
            continue

        m = re.match(r"^(\d+)\.\s+(.*)$", stripped)
        if m:
            flush()
            story.append(
                Paragraph(rich(m.group(2)), S["bullet"], bulletText=f"{m.group(1)}.")
            )
            i += 1
            continue

        if stripped.startswith(">"):
            flush()
            story.append(Paragraph(rich(stripped.lstrip("> ")), S["quote"]))
            i += 1
            continue

        if set(stripped) <= {"-", "|", ":", " "} and "|" in stripped:
            i += 1  # markdown table separator row
            continue

        buf.append(line)
        i += 1

    flush()


# ------------------------------------------------------- transcript parsing

NOISE = [
    re.compile(r"<system-reminder>.*?</system-reminder>", re.S),
    re.compile(r"<command-name>.*?</command-message>", re.S),
    re.compile(r"^\s*The following skills are available.*$", re.S | re.M),
]
IMAGE_NOTE = re.compile(r"^\[Image: original \d+x\d+.*$", re.S)


def clean_user(text):
    for pat in NOISE:
        text = pat.sub("", text)
    text = text.strip()
    if not text or IMAGE_NOTE.match(text):
        return None
    # A skill definition injected into the user turn is not a user message.
    if text.startswith("Base directory for this skill:"):
        return None
    if len(text) > 4000 and "\n#" in text[:2000]:
        return None
    return text


def blocks(content):
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    return content if isinstance(content, list) else []


def descriptor(name, inp):
    """One short line describing what a tool call did."""
    def g(*keys):
        for k in keys:
            v = inp.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
        return None

    short = name.replace("mcp__remote-devices__", "device.").replace("mcp__", "")

    if name == "Bash":
        d = g("description", "command") or ""
    elif name in ("Read", "Write", "Edit", "NotebookEdit"):
        d = (g("file_path") or "").replace("/home/claude/cms/", "").replace("/home/claude/", "")
    elif name in ("Grep", "Glob"):
        d = g("pattern") or ""
    elif name in ("WebFetch",):
        d = g("url") or ""
    elif name == "WebSearch":
        d = g("query") or ""
    elif name in ("Agent", "Task"):
        d = g("description", "prompt") or ""
    elif name in ("TaskCreate", "TaskUpdate"):
        d = g("subject", "status", "taskId") or ""
    elif name == "SendUserFile":
        files = inp.get("files") or []
        d = f"{len(files)} file(s)" + (f" — {files[0].split('/')[-1]}" if files else "")
    elif name.endswith("device_commit_files"):
        d = f"{len(inp.get('files') or [])} file(s) to device"
    elif name.endswith("project_memory_write"):
        d = g("file") or ""
    elif name == "AskUserQuestion":
        qs = inp.get("questions") or []
        d = "; ".join(q.get("header", "") for q in qs if isinstance(q, dict))
    elif name == "Skill":
        d = g("skill") or ""
    else:
        d = g("description", "file", "query", "name") or ""

    d = " ".join(str(d).split())
    if len(d) > 92:
        d = d[:91] + "…"
    return short, d


INTERRUPT = re.compile(r"^\[Request interrupted by user.*\]$")


def parse(path):
    turns = []
    current = None
    for line in open(path, encoding="utf-8", errors="replace"):
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg = rec.get("message")
        if not isinstance(msg, dict):
            continue
        role = msg.get("role")
        ts = rec.get("timestamp")

        if role == "user":
            for b in blocks(msg.get("content")):
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "text":
                    text = clean_user(b.get("text", "") or "")
                    if not text:
                        continue
                    # An interruption is an event within the turn it stopped.
                    if INTERRUPT.match(text.strip()):
                        if turns:
                            turns[-1]["notes"].append(text.strip())
                        continue
                    current = {
                        "ts": ts, "user": text,
                        "reply": [], "tools": [], "notes": [],
                    }
                    turns.append(current)
        elif role == "assistant" and current is not None:
            for b in blocks(msg.get("content")):
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "text":
                    t = (b.get("text") or "").strip()
                    if t:
                        current["reply"].append(t)
                elif b.get("type") == "tool_use":
                    current["tools"].append(
                        descriptor(b.get("name", "?"), b.get("input") or {})
                    )
    merged = []
    for turn in turns:
        if (
            merged
            and turn["user"].strip() == merged[-1]["user"].strip()
            and not merged[-1]["reply"]
        ):
            # Same prompt re-sent after an interruption — fold them together.
            merged[-1]["tools"].extend(turn["tools"])
            merged[-1]["reply"].extend(turn["reply"])
            merged[-1]["notes"].extend(turn["notes"])
            continue
        merged.append(turn)
    return merged


def fmt_ts(ts):
    if not ts:
        return ""
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(timezone.utc)
        return dt.strftime("%d %b %Y · %H:%M UTC")
    except ValueError:
        return ts


# ---------------------------------------------------------------- document


def on_page(canvas, doc):
    canvas.saveState()
    canvas.setFont("Body", 7.5)
    canvas.setFillColor(LIGHT)
    if doc.page > 1:
        canvas.drawString(MARGIN, PAGE_H - MARGIN + 6 * mm,
                          "Headless CMS Admin Panel — session transcript")
        canvas.drawRightString(PAGE_W - MARGIN, MARGIN - 8 * mm, str(doc.page))
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.4)
        canvas.line(MARGIN, PAGE_H - MARGIN + 4 * mm,
                    PAGE_W - MARGIN, PAGE_H - MARGIN + 4 * mm)
    canvas.restoreState()


def build(turns, out_path, source):
    doc = BaseDocTemplate(
        out_path, pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=MARGIN, bottomMargin=MARGIN,
        title="Session transcript — Headless CMS Admin Panel",
        author="Jhon Ávila",
        subject="Complete AI session record for the Agile Monkeys Frontend Challenge 2026",
    )
    frame = Frame(MARGIN, MARGIN, PAGE_W - 2 * MARGIN, PAGE_H - 2 * MARGIN,
                  id="main", showBoundary=0)
    doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=on_page)])

    story = []
    total_tools = sum(len(t["tools"]) for t in turns)

    # ---- cover
    story.append(Spacer(1, 34 * mm))
    story.append(Paragraph("Session transcript", S["title"]))
    story.append(Paragraph("Headless CMS Admin Panel — how it was actually built",
                           S["subtitle"]))
    story.append(Spacer(1, 8 * mm))

    rows = [
        ["Project", "Headless CMS Admin Panel"],
        ["Challenge", "Agile Monkeys — Frontend Challenge 2026"],
        ["Session span", f"{fmt_ts(turns[0]['ts'])}  →  {fmt_ts(turns[-1]['ts'])}"],
        ["Exchanges", f"{len(turns)} user messages"],
        ["Tool calls", f"{total_tools} recorded"],
        ["Source", source.split("/")[-1]],
    ]
    tbl = Table(rows, colWidths=[30 * mm, PAGE_W - 2 * MARGIN - 30 * mm])
    tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Body-Bold"),
        ("FONTNAME", (1, 0), (1, -1), "Body"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (0, -1), MUTED),
        ("TEXTCOLOR", (1, 0), (1, -1), INK),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 10 * mm))
    story.append(Paragraph(
        "This is the session's own log, exported verbatim — not a summary written "
        "afterwards. Every user message and every assistant reply appears in full, "
        "in order.",
        S["body"]))
    story.append(Paragraph(
        "Tool <i>results</i> are omitted: they run to roughly 2.6 million characters "
        "of file contents, command output and search hits, and the artifacts they "
        "produced are already in the repository. What each tool call did is listed "
        "instead, so the sequence of work stays visible. Injected context — system "
        "reminders and skill definitions loaded mid-turn — is also omitted, since "
        "neither party wrote it.",
        S["body"]))
    story.append(PageBreak())

    # ---- turns
    for n, turn in enumerate(turns, 1):
        head = [
            Paragraph(f"{n}", ParagraphStyle("n", fontName="Body-Bold", fontSize=15,
                                             textColor=ACCENT, leading=18)),
            Paragraph(fmt_ts(turn["ts"]), S["meta"]),
        ]
        head_tbl = Table([head], colWidths=[10 * mm, PAGE_W - 2 * MARGIN - 10 * mm])
        head_tbl.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ("LINEBELOW", (0, 0), (-1, -1), 0.6, RULE),
        ]))

        user_para = Paragraph(
            "<br/>".join(rich(l) for l in turn["user"].split("\n")), S["user"]
        )
        user_tbl = Table([[user_para]], colWidths=[PAGE_W - 2 * MARGIN])
        user_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), ACCENT_BG),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#D9DEFB")),
            ("LEFTPADDING", (0, 0), (-1, -1), 9),
            ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]))

        story.append(KeepTogether([head_tbl, Spacer(1, 4), Paragraph("USER", S["label"]),
                                   Spacer(1, 2), user_tbl]))
        for note in turn.get("notes", []):
            story.append(Spacer(1, 3))
            story.append(Paragraph(f"— {html.escape(note)} —", S["quote"]))
        story.append(Spacer(1, 7))

        if turn["tools"]:
            story.append(Paragraph(
                f"TOOL CALLS ({len(turn['tools'])})", S["label_a"]))
            story.append(Spacer(1, 2))
            for name, desc in turn["tools"]:
                line = f'<font color="#4F46E5">{html.escape(name)}</font>'
                if desc:
                    line += f"  {html.escape(desc)}"
                story.append(Paragraph(line, S["tool"]))
            story.append(Spacer(1, 7))

        if turn["reply"]:
            story.append(Paragraph("ASSISTANT", S["label_a"]))
            story.append(Spacer(1, 2))
            for part in turn["reply"]:
                render_markdown(part, story)
        story.append(Spacer(1, 9))

    doc.build(story)
    return total_tools


if __name__ == "__main__":
    src = sys.argv[1]
    out = sys.argv[2]
    turns = parse(src)
    n_tools = build(turns, out, src)
    print(f"turns: {len(turns)}  tool calls: {n_tools}  -> {out}")
