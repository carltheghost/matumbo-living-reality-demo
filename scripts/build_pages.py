"""Build the credential-free static site on Windows, macOS, or Linux."""
from pathlib import Path
import argparse
import shutil
import re

ROOT = Path(__file__).resolve().parents[1]
MARKER = '<script type="module">import("./src/render/reality-25-bridge.js?v=20261003-skin360").catch((error)=>{try{console.warn("[reality25] optional surface degraded:",error);}catch{}});</script>'


def build(destination):
    destination = Path(destination).resolve()
    sources = [ROOT / name for name in ("src", "vendor", "assets", "public") if (ROOT / name).is_dir()]
    if destination == ROOT or any(destination == source or destination.is_relative_to(source) for source in sources):
        raise ValueError("Build output must be separate from runtime sources.")
    if destination.exists() and any(destination.iterdir()):
        raise ValueError("Use an empty build output directory.")
    destination.mkdir(parents=True, exist_ok=True)
    count = 0
    for source in sources:
        for file in source.rglob("*"):
            if not file.is_file() or file.is_symlink() or any(part.startswith(".") for part in file.relative_to(source).parts):
                continue
            target = destination / file.relative_to(ROOT)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, target)
            count += 1
    for file in ROOT.iterdir():
        if file.is_file() and not file.is_symlink() and (file.suffix in (".html", ".css", ".js") or file.name in ("favicon.svg", ".nojekyll")):
            shutil.copyfile(file, destination / file.name)
            count += 1
    page = destination / "index.html"
    html = page.read_text(encoding="utf-8")
    if not re.search(r'''import\(["']\./src/render/reality-25-bridge\.js(?:\?[^"']*)?["']\)''',html):
        html = html.replace("</body>", MARKER + "</body>")
        page.write_text(html, encoding="utf-8")
    (destination / "health.txt").write_text("maTumbo Living Reality deployment\n", encoding="utf-8")
    return count + 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", default="dist")
    args = parser.parse_args()
    print(f"Built {build(args.output)} static files.")
