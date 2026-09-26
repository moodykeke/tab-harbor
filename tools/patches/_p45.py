import os, io, zipfile, json

root = os.getcwd()
parent = os.path.dirname(root)
EXCLUDE = {'dev-server.js', 'README.md'}
EXCLUDE_DIRS = {'test', 'tools'}
SHARED_KEEP = {'store.js', 'i18n.js', 'mock-chrome.js'}
ship = []
for dirpath, dirnames, filenames in os.walk(root):
    rel = os.path.relpath(dirpath, root)
    if rel == '.':
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        filenames[:] = [f for f in filenames if not (f in EXCLUDE or f.startswith('_'))]
    else:
        top = rel.split(os.sep)[0]
        if top == 'shared':
            filenames[:] = [f for f in filenames if f in SHARED_KEEP]
    for f in filenames:
        full = os.path.join(dirpath, f)
        ship.append((os.path.relpath(full, root).replace(os.sep, '/'), full))
ship.sort()
zip_path = os.path.join(parent, 'tab-harbor-v3.10.2-cws.zip')
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for relpath, full in ship:
        z.write(full, relpath)
with zipfile.ZipFile(zip_path) as z:
    names = z.namelist()
    assert 'manifest.json' in names and z.testzip() is None
    assert '_locales/zh_CN/messages.json' in names and '_locales/en/messages.json' in names
old = os.path.join(parent, 'tab-harbor-v3.10.1-cws.zip')
if os.path.exists(old):
    os.remove(old)
print('v3.10.2 zip:', len(names), 'files,', round(os.path.getsize(zip_path) / 1024, 1), 'KB')
