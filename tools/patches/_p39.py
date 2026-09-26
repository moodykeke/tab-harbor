import io

p = 'background.js'
s = io.open(p, encoding='utf-8').read()

# 修复 1:处理器把 onlyNewKeys 传入 saveWindow 的 opts
old = """        case 'saveWindow':
          return await saveWindow(null, { fromManager: !!msg.fromManager });"""
new = """        case 'saveWindow':
          return await saveWindow(null, { fromManager: !!msg.fromManager, onlyNewKeys: msg.__onlyNewKeys });"""
assert old in s, 'handler call'
s = s.replace(old, new)

# 修复 2:saveWindow 内改用 opts.onlyNewKeys(msg 不在作用域 —— 真机必现 ReferenceError)
old = """  // 智能去重(仅存新增):manager 传入"已收藏"的身份键集合
  if (Array.isArray(msg.__onlyNewKeys) && msg.__onlyNewKeys.length) {
    const known = new Set(msg.__onlyNewKeys);
    group.tabs = group.tabs.filter((t) => !known.has(BGTStore.normalizeUrl(t.url).key));
    if (!group.tabs.length) return { ok: true, saved: 0, allKnown: true };
  }"""
new = """  // 智能去重(仅存新增):manager 传入"已收藏"的身份键集合
  if (Array.isArray(opts.onlyNewKeys) && opts.onlyNewKeys.length) {
    const known = new Set(opts.onlyNewKeys);
    group.tabs = group.tabs.filter((t) => !known.has(BGTStore.normalizeUrl(t.url).key));
    if (!group.tabs.length) return { ok: true, saved: 0, allKnown: true };
  }"""
assert old in s, 'saveWindow scope'
s = s.replace(old, new)

# 修复 3:全文件扫描确认不再有作用域外 msg 引用(处理器之外)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)

# ============ 顺带提升可调试性:保存失败透出后台原因 ============
p = 'manager/modules/actions.js'
s = io.open(p, encoding='utf-8').read()
old = """  function sendSaveWindow(onlyNewKeys) {
    return (async () => {
      const res = await send({ action: 'saveWindow', fromManager: true, __onlyNewKeys: onlyNewKeys });
      if (res && res.ok) {
        if (res.allKnown || res.saved === 0) { toast(tr('没有需要新增的标签')); return; }
        toast(tr('已保存 {n} 个新增标签', { n: res.saved }));
        state.data = await BGTStore.load();
        render();
      } else if (res && res.reason === 'empty') {
        toast(tr('没有可保存的标签'));
      } else {
        toast(tr('保存失败:后台服务不可用'));
      }
    })();
  }"""
new = """  function sendSaveWindow(onlyNewKeys) {
    return (async () => {
      const res = await send({ action: 'saveWindow', fromManager: true, __onlyNewKeys: onlyNewKeys });
      if (res && res.ok) {
        if (res.allKnown || res.saved === 0) { toast(tr('没有需要新增的标签')); return; }
        toast(tr('已保存 {n} 个新增标签', { n: res.saved }));
        state.data = await BGTStore.load();
        render();
      } else if (res && res.reason === 'empty') {
        toast(tr('没有可保存的标签'));
      } else {
        toast(tr('保存失败:') + failureDetail(res));
      }
    })();
  }"""
assert old in s, 'sendSaveWindow'
s = s.replace(old, new)

old = """  } else if (res && res.reason === 'empty') {
      toast(tr('没有可保存的标签'));
    } else {
      toast(tr('保存失败:后台服务不可用'));
    }
  }

  function sendSaveWindow"""
new = """  } else if (res && res.reason === 'empty') {
      toast(tr('没有可保存的标签'));
    } else {
      toast(tr('保存失败:') + failureDetail(res));
    }
  }

  function sendSaveWindow"""
assert old in s, 'doSave tail'
s = s.replace(old, new)

# failureDetail 工具:透出后台原因,便于真机定位
old = """/* ---------------- 跳转与重复洞察 ---------------- */"""
new = """/** 保存失败的细节透出(后台 reason / 无响应) */
function failureDetail(res) {
  if (res && res.reason) return String(res.reason);
  return tr('后台服务不可用');
}

/* ---------------- 跳转与重复洞察 ---------------- */"""
assert old in s, 'failureDetail anchor'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('manager debug ok')

# popup.js 同样透出原因
p = 'popup/popup.js'
s = io.open(p, encoding='utf-8').read()
old = """      } else if (res && res.reason === 'empty') {
        toast('没有可保存的标签', true);
      } else {
        toast('保存失败:后台服务不可用', true);
      }
    } else if (res && res.reason === 'empty') {
      toast('没有可保存的标签', true);
    } else {
      toast('保存失败:后台服务不可用', true);
    }
  }"""
# popup 有两处 doSave 与 clockOut;分别精确替换
cnt = 0
while """      } else {
        toast('保存失败:后台服务不可用', true);
      }""" in s:
    s = s.replace("""      } else {
        toast('保存失败:后台服务不可用', true);
      }""", """      } else {
        toast('保存失败:' + (res && res.reason ? res.reason : '后台服务不可用'), true);
      }""", 1)
    cnt += 1
while """    } else {
      toast('保存失败:后台服务不可用', true);
    }""" in s:
    s = s.replace("""    } else {
      toast('保存失败:后台服务不可用', true);
    }""", """    } else {
      toast('保存失败:' + (res && res.reason ? res.reason : '后台服务不可用'), true);
    }""", 1)
    cnt += 1
while """      } else {
        toast('收工失败:后台服务不可用', true);
      }""" in s:
    s = s.replace("""      } else {
        toast('收工失败:后台服务不可用', true);
      }""", """      } else {
        toast('收工失败:' + (res && res.reason ? res.reason : '后台服务不可用'), true);
      }""", 1)
    cnt += 1
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('popup debug ok, replaced', cnt)
