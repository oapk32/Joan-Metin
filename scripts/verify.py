#!/usr/bin/env python3
"""Check that the original v134 game remains intact behind the multiplayer bridge."""
from pathlib import Path
import re
import hashlib
import subprocess

root = Path(__file__).resolve().parents[1]
original_html = (root / "release/joan_metiny_2d_v134.html").read_text(encoding="utf-8")
html = (root / "client/index.html").read_text(encoding="utf-8")
style = re.search(r"<style>(.*?)</style>", original_html, re.S).group(1)
scripts = re.findall(r"<script(?:\s[^>]*)?>(.*?)</script>", original_html, re.S)
assert len(scripts) == 2, "Expected exactly two original embedded scripts"
assert (root / "client/css/game.css").read_text(encoding="utf-8") == style
assert (root / "client/js/audio-data.js").read_text(encoding="utf-8") == scripts[0]

game = (root / "client/js/game.js").read_text(encoding="utf-8")
begin = "  // Multiplayer presence: draw remote avatars with the same existing v38 character rig.\n"
end = "  function v38DrawHero() {"
assert game.count(begin) == 1 and game.count(end) == 1, "Unexpected online rig position"
a = game.index(begin)
b = game.index(end, a)
game = game[:a] + game[b:]

hooks = [
    "    window.JoanMP?.tick(player, current, now);\n",
    "    for (const peer of window.JoanMP?.getPeers() || []) list.push({ y: peer.y, k: 4.5, o: peer });\n",
    "      else if (e.k === 4.5) v38DrawOnlinePeer(e.o);\n",
]
for hook in hooks:
    assert game.count(hook) == 1, "Missing/duplicated online-only hook"
    game = game.replace(hook, "")

assert game == scripts[1], "Game logic differs from original v134 beyond the known online hooks"
assert '<link rel="stylesheet" href="css/game.css">' in html
for filename in ("audio-data.js", "mp-bridge.js", "game.js"):
    assert f'<script src="js/{filename}"></script>' in html
assert "<style>" not in html

for filename in ("audio-data.js", "mp-bridge.js", "game.js"):
    subprocess.run(["node", "--check", str(root / "client/js" / filename)], check=True)
subprocess.run(["node", "--check", str(root / "server/index.js")], check=True)

print("PASS: v134 CSS, audio and game logic preserved behind explicit online hooks")
print("PASS: JavaScript syntax verified")
print("Release SHA-256:", hashlib.sha256((root / "release/joan_metiny_2d_v134.html").read_bytes()).hexdigest())
