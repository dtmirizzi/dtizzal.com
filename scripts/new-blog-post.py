#!/usr/bin/env python3
"""Scaffold a new blog post.

Usage:
  scripts/new-blog-post.py "My Title Goes Here" \
      [--description "Short SEO description"] \
      [--slug custom-slug] \
      [--date "March 2026"] \
      [--dry-run]

Defaults:
  - slug         = lowercased title with non-alphanum → '-'
  - description  = same as title
  - date         = current Month YYYY (e.g. "March 2026")

What it does:
  1. Picks the next post number (max(existing) + 1).
  2. Creates blog-posts/{N}-{slug}/{slug}.html from blog-posts/template.html
     with {{TITLE}} / {{DESCRIPTION}} substituted.
  3. Adds a new <li> at the top of blog.html's post list.
  4. Adds an entry to data/blog-index.json (if present).

Idempotent on re-run: if the target dir already exists, exits with an error
instead of clobbering.
"""
import argparse
import datetime as dt
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BLOG_DIR = ROOT / "blog-posts"
TEMPLATE = BLOG_DIR / "template.html"
BLOG_INDEX_HTML = ROOT / "blog.html"
# Note: data/blog-index.json, sitemap.xml, and llms.txt are auto-generated
# by .github/workflows/build-blog-index.yml on push, so we don't touch them here.


def slugify(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def next_post_number() -> int:
    nums = []
    for p in BLOG_DIR.iterdir():
        if not p.is_dir():
            continue
        m = re.match(r"(\d+)-", p.name)
        if m:
            nums.append(int(m.group(1)))
    return (max(nums) + 1) if nums else 1


def render_template(title: str, description: str) -> str:
    body = TEMPLATE.read_text()
    return body.replace("{{TITLE}}", title).replace("{{DESCRIPTION}}", description)


def update_blog_html(title: str, slug: str, num: int, date_str: str, dry_run: bool):
    if not BLOG_INDEX_HTML.exists():
        print(f"  skip: {BLOG_INDEX_HTML} not found")
        return
    src = BLOG_INDEX_HTML.read_text()
    # Find the first <li> inside the first <ul> after the post list heading.
    # Pattern is consistent across the file: `<ul>\n<li>\n<a href="/blog-posts/...">`.
    # We insert immediately before the first such `<li>`.
    pattern = re.compile(
        r'(<ul>\s*\n)(\s*)(<li>\s*\n\s*<a href="/blog-posts/)',
        re.IGNORECASE,
    )
    new_li = (
        f'            <li>\n'
        f'                <a href="/blog-posts/{num}-{slug}/{slug}.html">\n'
        f'                    → {title} <span class="blog-date">{date_str}</span>\n'
        f'                </a>\n'
        f'            </li>\n'
    )
    new_src, n = pattern.subn(lambda m: m.group(1) + new_li + m.group(2) + m.group(3), src, count=1)
    if n == 0:
        print("  warning: could not auto-insert into blog.html (pattern not found)")
        print(f"  add this <li> manually:\n{new_li}")
        return
    if dry_run:
        print(f"  would update blog.html (insert <li> for #{num})")
    else:
        BLOG_INDEX_HTML.write_text(new_src)
        print(f"  updated blog.html (added <li> at top)")


def main():
    ap = argparse.ArgumentParser(description="Scaffold a new blog post")
    ap.add_argument("title", help="Title of the post (use quotes)")
    ap.add_argument("--description", help="SEO description (defaults to the title)")
    ap.add_argument("--slug", help="Override the auto-generated slug")
    ap.add_argument("--date", help='Display date e.g. "March 2026" (default: current month)')
    ap.add_argument("--dry-run", action="store_true", help="Print what would happen without writing files")
    args = ap.parse_args()

    title = args.title.strip()
    if not title:
        print("error: title is empty", file=sys.stderr)
        return 1

    slug = args.slug or slugify(title)
    if not slug:
        print("error: empty slug — pass --slug explicitly", file=sys.stderr)
        return 1

    description = (args.description or title).strip()
    date_str = args.date or dt.date.today().strftime("%B %Y")
    num = next_post_number()

    target_dir = BLOG_DIR / f"{num}-{slug}"
    target_html = target_dir / f"{slug}.html"

    if target_dir.exists():
        print(f"error: {target_dir} already exists", file=sys.stderr)
        return 1
    if not TEMPLATE.exists():
        print(f"error: template missing at {TEMPLATE}", file=sys.stderr)
        return 1

    print(f"Creating post #{num}: {title}")
    print(f"  slug: {slug}")
    print(f"  path: {target_html.relative_to(ROOT)}")
    print(f"  date: {date_str}")

    rendered = render_template(title, description)

    if args.dry_run:
        print("  dry-run — not writing files")
    else:
        target_dir.mkdir(parents=True)
        target_html.write_text(rendered)
        print(f"  wrote {target_html.relative_to(ROOT)}")

    update_blog_html(title, slug, num, date_str, args.dry_run)

    if not args.dry_run:
        print(f"\nDone. Open it: open {target_html}")
        print("Push to master and the workflow will regenerate llms.txt + sitemap.xml.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
