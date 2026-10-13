#!/usr/bin/env python3
"""Verify original v134 parity, allowing two explicit multiplayer visualization hooks."""
from pathlib import Path
import re
import hashlib
import subprocess

root = Path(__file__).resolve().parents[1]
orig = (root / 'release/joan_metiny_2d_v134.html').read_text(encoding='utf-8')
html = (root / 'client/index.html').read_text(encoding='utf-8')
style = re.search(r'<style>(.*?)</style>', orig, re.S).group(1)
scripts = re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>', orig, re.S)
assert len(scripts) == 2, 'Unexpected embedded script count'
assert (root / 'client/css/game.css').read_text(encoding='utf-8') == style
assert (root / 'client/js/audio-data.js').read_text(encoding='utf-8') == scripts[0]

game = (root / 'client/js/game.js').read_text(encoding='utf-8')
hooks = [
    '    window.JoanMP?.tick(player, current, now);\n',
    '    window.JoanMP?.draw(cx, player, current, V38.scale);\n',
]
for hook in hooks:
    assert game.count(hook) == 1, 'Expected exactly one network hook'
    game = game.replace(hook, '')
assert game == scripts[1], 'Game code differs from v134 beyond the known network hooks'

assert '<link rel="stylesheet" href="css/game.css">' in html
for asset in ['audio-data.js', 'mp-bridge.js', 'game.js']:
    assert f'<script src="js/{asset}"></script>' in html
assert '<style>' not in html

for filename in ['audio-data.js', 'mp-bridge.js', 'game.js']:
    subprocess.run(['node', '--check', str(root / 'client/js' / filename)], check=True)
subprocess.run(['node', '--check', str(root / 'server/index.js')], check=True)
print('PASS: CSS, audio, and v134 game logic unchanged except for two explicit multiplayer hooks')
print('PASS: Node syntax checks for all client scripts and multiplayer server')
print('Release SHA-256:', hashlib.sha256((root / 'release/joan_metiny_2d_v134.html').read_bytes()).hexdigest())
