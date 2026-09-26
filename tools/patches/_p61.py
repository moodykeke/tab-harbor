import io

# ============ background.js:mutate 端点(Single Writer 第一步) ============
p = 'background.js'
s = io.open(p, encoding='utf-8').read()

old = """        case 'restoreWorkspace':
          return await restoreWorkspace(msg.workspaceId, msg.mode || 'new');"""
new = """        case 'restoreWorkspace':
          return await restoreWorkspace(msg.workspaceId, msg.mode || 'new');
        case 'renameGroup':
          // Single Writer:列表级 UI 态写操作收口到 SW 串行执行,
          // 消除管理页防抖写与 Alt+S 后台保存的双写竞争
          return await BGTStore.mutate(async () => {
            const data = await BGTStore.load();
            const group = data.groups.find((g) => g.id === msg.groupId);
            if (!group) return { ok: false, reason: 'not-found' };
            group.title = String(msg.title || '').trim();
            await BGTStore.persist(data);
            return { ok: true, title: group.title };
          });
        case 'renameWorkspace':
          return await BGTStore.mutate(async () => {
            const data = await BGTStore.load();
            const ws = data.workspaces.find((w) => w.id === msg.workspaceId);
            if (!ws) return { ok: false, reason: 'not-found' };
            ws.title = String(msg.title || '').trim();
            await BGTStore.persist(data);
            return { ok: true, title: ws.title };
          });"""
assert old in s, 'B routes'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('background routes ok')

# ============ events.js:重命名路由到 SW 端点(不再本地双写) ============
p = 'manager/modules/events.js'
s = io.open(p, encoding='utf-8').read()
old = """      if (!e.target.matches('.group__title')) return;
      const card = e.target.closest('.group');
      const group = state.data.groups.find((g) => g.id === card.dataset.id);
      if (!group) return;
      group.title = e.target.value.trim();
      persistAndRenderSoon();
    });"""
new = """      if (!e.target.matches('.group__title')) return;
      const card = e.target.closest('.group');
      const group = state.data.groups.find((g) => g.id === card.dataset.id);
      if (!group) return;
      group.title = e.target.value.trim();
      // Single Writer:走后台串行端点,避免与后台保存双写竞争
      send({ action: 'renameGroup', groupId: group.id, title: group.title });
    });"""
assert old in s, 'rename group'
s = s.replace(old, new, 1)

old = """      if (!e.target.matches('.ws__title')) return;
      const card = e.target.closest('.ws');
      const ws = state.data.workspaces.find((x) => x.id === card.dataset.id);
      if (!ws) return;
      ws.title = e.target.value.trim();
      persist().then(renderWorkspaces);
    });"""
new = """      if (!e.target.matches('.ws__title')) return;
      const card = e.target.closest('.ws');
      const ws = state.data.workspaces.find((x) => x.id === card.dataset.id);
      if (!ws) return;
      ws.title = e.target.value.trim();
      send({ action: 'renameWorkspace', workspaceId: ws.id, title: ws.title });
    });"""
assert old in s, 'ws rename'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('events ok')
