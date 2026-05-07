#!/usr/bin/env python3
"""Apply perf-fix migrations across the dtizzal.com HTML files.

Changes:
1. Replace `<span class="material-symbols-outlined">NAME</span>` with the
   corresponding inline SVG icon. Theme-toggle icons (id="theme-icon") become
   an empty <span> that theme.js fills in (so toggling still works).
2. Drop the `<link href="...Material+Symbols+Outlined">` stylesheet links.
3. Make Courier Prime non-blocking via media="print" onload swap.

Idempotent — safe to re-run; already-migrated files are left alone.
"""
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Inline SVGs. Sized via CSS (.icon class), 24×24 viewBox. Sourced from Material
# Symbols (Apache 2.0). currentColor so dark/light themes work.
SVGS = {
    "light_mode": '<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M12 2.25a.75.75 0 0 1 .75.75v2.25a.75.75 0 0 1-1.5 0V3a.75.75 0 0 1 .75-.75ZM7.5 12a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM18.894 6.166a.75.75 0 0 0-1.06-1.06l-1.591 1.59a.75.75 0 1 0 1.06 1.061l1.591-1.59ZM21.75 12a.75.75 0 0 1-.75.75h-2.25a.75.75 0 0 1 0-1.5H21a.75.75 0 0 1 .75.75ZM17.834 18.894a.75.75 0 0 0 1.06-1.06l-1.59-1.591a.75.75 0 1 0-1.061 1.06l1.59 1.591ZM12 18a.75.75 0 0 1 .75.75V21a.75.75 0 0 1-1.5 0v-2.25A.75.75 0 0 1 12 18ZM7.758 17.303a.75.75 0 0 0-1.061-1.06l-1.591 1.59a.75.75 0 0 0 1.06 1.061l1.591-1.59ZM6 12a.75.75 0 0 1-.75.75H3a.75.75 0 0 1 0-1.5h2.25A.75.75 0 0 1 6 12ZM6.697 7.757a.75.75 0 0 0 1.06-1.06l-1.59-1.591a.75.75 0 0 0-1.061 1.06l1.59 1.591Z" clip-rule="evenodd"/></svg>',
    "dark_mode": '<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/></svg>',
    "download": '<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3a1 1 0 0 1 1 1v9.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V4a1 1 0 0 1 1-1zM4 19a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1z"/></svg>',
    "lock": '<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 1 1 6 0v3H9z"/></svg>',
    "rocket_launch": '<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.4 3.7c2-1.6 4.2-2 5.6-1.7.3 1.4-.1 3.6-1.7 5.6L17 9l-2-2 1.4-1.4-2.1-2.1 0 .2zm-1.6 1.6L8.1 10l1.4 1.4 4.7-4.7zM7 14a4 4 0 0 0-3 4l3-1 1-3a4 4 0 0 0 0-1l-1 1zM4 21l3-1c1 0 2 0 3-1l-1-3-3 1c-1 1-1 2-2 4z"/></svg>',
    "terminal": '<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H3zm2.3 4.3a1 1 0 0 1 1.4 0l3 3a1 1 0 0 1 0 1.4l-3 3a1 1 0 1 1-1.4-1.4L7.6 12 5.3 9.7a1 1 0 0 1 0-1.4zM12 14h6a1 1 0 1 1 0 2h-6a1 1 0 1 1 0-2z"/></svg>',
    "robot_2": '<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a1 1 0 0 1 1 1v2h4a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h4V3a1 1 0 0 1 1-1zM8.5 10a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM3 11a1 1 0 0 0-1 1v2a1 1 0 1 0 2 0v-2a1 1 0 0 0-1-1zm18 0a1 1 0 0 0-1 1v2a1 1 0 1 0 2 0v-2a1 1 0 0 0-1-1z"/></svg>',
}

# Patterns
SPAN_PATTERN = re.compile(
    r'<span\s+class="material-symbols-outlined"(?P<attrs>[^>]*)>\s*(?P<name>[\w_\-]+)\s*</span>',
    re.IGNORECASE,
)
ICON_FONT_LINK = re.compile(
    r'\s*<link[^>]+fonts\.googleapis\.com/css2\?family=Material\+Symbols\+Outlined[^>]*>\s*\n?',
    re.IGNORECASE,
)
COURIER_PRIME_LINK = re.compile(
    r'<link\s+href="(https://fonts\.googleapis\.com/css2\?family=Courier\+Prime[^"]+)"\s+rel="stylesheet"\s*/?>',
    re.IGNORECASE,
)


def replace_icons(html: str) -> tuple[str, int]:
    n = 0

    def repl(m: re.Match) -> str:
        nonlocal n
        attrs = m.group("attrs") or ""
        name = m.group("name").strip()
        # Theme-toggle icon: keep id="theme-icon" so theme.js can find it.
        # Stamp a default light_mode SVG so there's no flicker before JS runs.
        if 'id="theme-icon"' in attrs:
            n += 1
            return f'<span class="theme-icon" id="theme-icon">{SVGS["light_mode"]}</span>'
        if name not in SVGS:
            print(f"  WARN: unknown icon '{name}' — leaving as-is", file=sys.stderr)
            return m.group(0)
        n += 1
        return SVGS[name]

    new = SPAN_PATTERN.sub(repl, html)
    return new, n


def drop_icon_font_link(html: str) -> tuple[str, int]:
    new, n = ICON_FONT_LINK.subn("", html)
    return new, n


def make_courier_async(html: str) -> tuple[str, int]:
    def repl(m: re.Match) -> str:
        url = m.group(1)
        return (
            f'<link rel="preload" as="style" href="{url}" '
            f'onload="this.onload=null;this.rel=\'stylesheet\'">'
            f'<noscript><link rel="stylesheet" href="{url}"></noscript>'
        )
    new, n = COURIER_PRIME_LINK.subn(repl, html)
    return new, n


def process(path: Path) -> dict:
    src = path.read_text()
    out, ic_count = replace_icons(src)
    out, link_count = drop_icon_font_link(out)
    out, font_count = make_courier_async(out)
    if out != src:
        path.write_text(out)
    return {"icons": ic_count, "links": link_count, "fonts": font_count}


def main():
    html_files = sorted(ROOT.rglob("*.html"))
    # Skip the ones that are intentionally outside our scope
    html_files = [p for p in html_files if "/scripts/" not in str(p) and "/.git/" not in str(p)]
    totals = {"icons": 0, "links": 0, "fonts": 0}
    for p in html_files:
        rel = p.relative_to(ROOT)
        result = process(p)
        totals["icons"] += result["icons"]
        totals["links"] += result["links"]
        totals["fonts"] += result["fonts"]
        if any(result.values()):
            print(f"  {rel}: {result['icons']} icons, {result['links']} link drops, {result['fonts']} fonts")
    print(f"\nTotals: {totals['icons']} icon replacements, {totals['links']} icon-font links removed, {totals['fonts']} Courier Prime links made non-blocking")
    print(f"Files scanned: {len(html_files)}")


if __name__ == "__main__":
    main()
