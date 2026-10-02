"""Stamp local CSS and JS links with a hash of their contents.

Without this, a visitor who already has the old styles.css keeps using it
against new HTML, which is the same stale-stylesheet bug as the local one but
on the live site. The query string changes only when the file changes, so
caching still works, it just cannot serve the wrong pair.

Run it after editing any CSS or JS, before committing.
"""
import hashlib, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSET = re.compile(r'((?:href|src)=")([^"]+?\.(?:css|js))(?:\?v=[a-f0-9]+)?(")')

def digest(path):
    return hashlib.md5(open(path, 'rb').read()).hexdigest()[:8]

cache, touched = {}, 0
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in ('.git', 'tools')]
    for fn in filenames:
        if not fn.endswith('.html'):
            continue
        page = os.path.join(dirpath, fn)
        html = open(page).read()

        def sub(m):
            url = m.group(2)
            if url.startswith(('http://', 'https://', '//')):
                return m.group(0)                      # leave the CDN alone
            target = os.path.normpath(os.path.join(dirpath, url.lstrip('/')))
            if not os.path.exists(target):
                return m.group(0)
            if target not in cache:
                cache[target] = digest(target)
            return f'{m.group(1)}{url}?v={cache[target]}{m.group(3)}'

        out = ASSET.sub(sub, html)
        if out != html:
            open(page, 'w').write(out)
            touched += 1

print(f'stamped {touched} pages against {len(cache)} assets')
for path, h in sorted(cache.items()):
    print(f'  {os.path.relpath(path, ROOT):<14} {h}')
