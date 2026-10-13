#!/usr/bin/env python3
from pathlib import Path
import re, hashlib, subprocess, sys
root=Path(__file__).resolve().parents[1]
orig=(root/'release/joan_metiny_2d_v134.html').read_text(encoding='utf-8')
html=(root/'client/index.html').read_text(encoding='utf-8')
style=re.search(r'<style>(.*?)</style>',orig,re.S).group(1)
scripts=re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>',orig,re.S)
assert len(scripts)==2, 'Unexpected script count'
assert (root/'client/css/game.css').read_text(encoding='utf-8')==style
assert (root/'client/js/audio-data.js').read_text(encoding='utf-8')==scripts[0]
assert (root/'client/js/game.js').read_text(encoding='utf-8')==scripts[1]
assert '<link rel="stylesheet" href="css/game.css">' in html
assert '<script src="js/audio-data.js"></script>' in html
assert '<script src="js/game.js"></script>' in html
assert '<style>' not in html
for name in ['audio-data.js','game.js']:
    subprocess.run(['node','--check',str(root/'client/js'/name)], check=True)
print('PASS: CSS/audio/game JS are byte-for-byte text equivalents of v134 embedded blocks')
print('PASS: Node syntax check for both JS files')
print('Release SHA-256:',hashlib.sha256((root/'release/joan_metiny_2d_v134.html').read_bytes()).hexdigest())
