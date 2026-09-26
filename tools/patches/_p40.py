import io

p = 'manager/modules/actions.js'
s = io.open(p, encoding='utf-8').read()

old = """function sendSaveWindow(onlyNewKeys) {
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
new = """function sendSaveWindow(onlyNewKeys) {
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
}

/** 保存失败的细节透出(后台 reason / 无响应),便于真机定位 */
function failureDetail(res) {
  if (res && res.reason) return String(res.reason);
  return tr('后台服务不可用');
}"""
assert old in s, 'sendSaveWindow'
s = s.replace(old, new, 1)

old = """    } else if (res && res.reason === 'empty') {
      toast(tr('没有可保存的标签'));
    } else {
      toast(tr('保存失败:后台服务不可用'));
    }
  }

  function sendSaveWindow"""
new = """    } else if (res && res.reason === 'empty') {
      toast(tr('没有可保存的标签'));
    } else {
      toast(tr('保存失败:') + failureDetail(res));
    }
  }

  function sendSaveWindow"""
assert old in s, 'doSave tail'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('actions ok')

# popup.js:两处保存失败 + 一处收工失败透出原因
p = 'popup/popup.js'
s = io.open(p, encoding='utf-8').read()
n = 0
for frag in [
    ("toast('保存失败:后台服务不可用', true);", "toast('保存失败:' + (res && res.reason ? res.reason : '后台服务不可用'), true);"),
    ("toast('收工失败:后台服务不可用', true);", "toast('收工失败:' + (res && res.reason ? res.reason : '后台服务不可用'), true);"),
]:
    while frag[0] in s:
        s = s.replace(frag[0], frag[1], 1)
        n += 1
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('popup ok, replaced', n)
