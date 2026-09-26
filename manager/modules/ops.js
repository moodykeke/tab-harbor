/**
 * Tab Harbor — ops:多步撤销 / 重做(基于 Operation 快照)
 * 栈项:{ label, before: {groups, workspaces}, listKey }。
 * 撤销 = 合并式恢复 before(只找回被删的,不覆盖期间的编辑);重做对称。
 * 会话级(不入盘);上限 20 步。removeTab 等细粒度操作仍走各自的单步撤销。
 */
import { state, $$, persistAndRender } from './core.js';
import { toast } from './ui.js';

const MAX = 10; // 全量快照式撤销,控制内存占用(步数换空间)

/**
 * 撤销栈项即 Operation(与 store 冻结模型对齐):
 * { id, type, payload: {label, listKey}, inverse: {type:'RESTORE_LIST', payload:{listKey, before}}, createdAt }
 * undo/redo = 执行 inverse(合并式恢复)。
 */
function makeListOperation(label, before, listKey, type) {
  const beforeCopy = {
    groups: listKey === 'workspaces' ? null : JSON.parse(JSON.stringify(before)),
    workspaces: listKey === 'workspaces' ? JSON.parse(JSON.stringify(before)) : null,
  };
  return BGTStore.makeOperation(
    type || 'LIST_OP',
    { label: label || '', listKey: listKey || 'groups' },
    { type: 'RESTORE_LIST', payload: { listKey: listKey || 'groups', before: beforeCopy } },
  );
}

function captureAll() {
  return {
    groups: JSON.parse(JSON.stringify(state.data.groups)),
    workspaces: JSON.parse(JSON.stringify(state.data.workspaces || [])),
  };
}

/** 在任何破坏性操作前调用:登记一条可撤销 Operation */
export function pushUndoOp(label, before, listKey, type) {
  const op = makeListOperation(label, before, listKey, type);
  op.before = op.inverse.payload.before; // 执行器读取的快照
  state.undoStack.push(op);
  if (state.undoStack.length > MAX) state.undoStack.shift();
  state.redoStack.length = 0;
}

function applyList(listKey, beforeList) {
  const merged = BGTStore.mergeGroups(beforeList, listKey === 'workspaces' ? state.data.workspaces : state.data.groups);
  if (listKey === 'workspaces') state.data.workspaces = merged;
  else state.data.groups = merged;
}

function executeInverse(op) {
  const inv = op.inverse;
  if (!inv || inv.type !== 'RESTORE_LIST') throw new Error('unsupported inverse: ' + (inv && inv.type));
  if (inv.payload.before.groups) applyList('groups', inv.payload.before.groups);
  if (inv.payload.before.workspaces) applyList('workspaces', inv.payload.before.workspaces);
}

export async function undo() {
  const op = state.undoStack.pop();
  if (!op) { toast(tr('没有可撤销的操作')); return; }
  const redoState = captureAll();
  executeInverse(op);
  await persistAndRender();
  const redoOp = BGTStore.makeOperation(
    op.type, { label: op.payload.label, listKey: op.payload.listKey },
    { type: 'RESTORE_LIST', payload: { listKey: op.payload.listKey, before: redoState } },
  );
  redoOp.before = redoState;
  state.redoStack.push(redoOp);
  toast(tr('已撤销:{label}', { label: op.payload.label }));
}

export async function redo() {
  const op = state.redoStack.pop();
  if (!op) { toast(tr('没有可重做的操作')); return; }
  const prevState = captureAll();
  executeInverse(op);
  await persistAndRender();
  const undoOp = BGTStore.makeOperation(
    op.type, { label: op.payload.label, listKey: op.payload.listKey },
    { type: 'RESTORE_LIST', payload: { listKey: op.payload.listKey, before: prevState } },
  );
  undoOp.before = prevState;
  state.undoStack.push(undoOp);
  toast(tr('已重做:{label}', { label: op.payload.label }));
}
