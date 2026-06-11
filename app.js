const STORAGE_KEY = "localmind.markdown.v1";
const LAYOUT_MODE_KEY = "localmind.layoutMode.v1";
const LABEL_MODE_KEY = "localmind.labelMode.v1";
const POSITIONS_KEY = "localmind.positions.v1";
const COLLAPSED_KEY = "localmind.collapsed.v1";
const SURFACE_WIDTH = 4200;
const SURFACE_HEIGHT = 3000;
const CENTER_X = SURFACE_WIDTH / 2;
const CENTER_Y = SURFACE_HEIGHT / 2;
const LEVEL_GAP = 230;
const ROW_GAP = 88;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.8;
const NODE_DRAG_THRESHOLD = 7;

const defaultMarkdown = `# 新しいマインドマップ
> Shift+Enterで2行目以降をコメントとして残せます
- 目的
  > まず何を整理するかを書く
  - すばやく整理する
  - Markdownで保存する
- アイデア
  > 折りたたみたい項目はノード右上のボタンで切り替え
  - Enterで編集
  - Ctrl+Enterで同階層
  - Tabで子ノード
- 次の一手
  > 必要な作業をここに集める`;

const els = {
  viewport: document.getElementById("canvasViewport"),
  surface: document.getElementById("mapSurface"),
  linkLayer: document.getElementById("linkLayer"),
  nodeLayer: document.getElementById("nodeLayer"),
  markdown: document.getElementById("markdownText"),
  layoutModeButtons: [...document.querySelectorAll("[data-layout-mode]")],
  labelModeButtons: [...document.querySelectorAll("[data-label-mode]")],
  undoButton: document.querySelector('[data-action="undo"]'),
  redoButton: document.querySelector('[data-action="redo"]'),
  nodeCount: document.getElementById("nodeCount"),
  saveStatus: document.getElementById("saveStatus"),
  messageLine: document.getElementById("messageLine"),
};

let state = {
  tree: parseMarkdown(localStorage.getItem(STORAGE_KEY) || defaultMarkdown),
  selectedId: null,
  editingId: null,
  layout: new Map(),
  parentById: new Map(),
  layoutMode: normalizeLayoutMode(localStorage.getItem(LAYOUT_MODE_KEY)),
  labelMode: normalizeLabelMode(localStorage.getItem(LABEL_MODE_KEY)),
  composing: false,
  markdownDirty: false,
  history: { past: [], future: [], limit: 100 },
  view: { x: 0, y: 0, zoom: 1 },
  manualOffsets: loadManualOffsets(),
  collapsedKeys: loadCollapsedKeys(),
  drag: null,
  suppressClick: false,
};

state.selectedId = state.tree.id;

function createNode(text, children = []) {
  return {
    id: crypto.randomUUID(),
    text: normalizeNodeText(text) || "無題",
    children,
  };
}

function normalizeLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeNodeText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean)
    .join("\n");
}

function getNodeLines(node) {
  return String(node.text || "").split("\n").filter(Boolean);
}

function getEditRowCount(value) {
  return Math.min(6, Math.max(1, String(value || "").replace(/\r\n?/g, "\n").split("\n").length));
}

function setEditRows(input) {
  const rows = getEditRowCount(input.value);
  input.rows = rows;
  input.setAttribute("rows", String(rows));
}

function getNodeTitle(node) {
  return getNodeLines(node)[0] || "無題";
}

function getNodeComments(node) {
  return getNodeLines(node).slice(1);
}

function appendNodeComment(node, comment) {
  const nextComment = normalizeLine(comment);
  if (!nextComment) return;
  node.text = `${normalizeNodeText(node.text) || "無題"}\n${nextComment}`;
}

function normalizeLayoutMode(value) {
  return value === "right" ? "right" : "balanced";
}

function normalizeLabelMode(value) {
  return value === "numbered" ? "numbered" : "plain";
}

function loadManualOffsets() {
  try {
    const raw = JSON.parse(localStorage.getItem(POSITIONS_KEY) || "{}");
    return new Map(
      Object.entries(raw)
        .filter(([, value]) => value && Number.isFinite(value.x) && Number.isFinite(value.y))
        .map(([key, value]) => [key, { x: value.x, y: value.y }])
    );
  } catch {
    return new Map();
  }
}

function loadCollapsedKeys() {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw.filter((key) => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

function cloneManualOffsets(offsets = state.manualOffsets) {
  return new Map([...offsets.entries()].map(([key, value]) => [key, { x: value.x, y: value.y }]));
}

function cloneCollapsedKeys(keys = state.collapsedKeys) {
  return new Set([...keys]);
}

function cloneTree(node) {
  return {
    id: node.id,
    text: node.text,
    children: node.children.map(cloneTree),
  };
}

function createSnapshot() {
  return {
    tree: cloneTree(state.tree),
    selectedId: state.selectedId,
    layoutMode: state.layoutMode,
    labelMode: state.labelMode,
    manualOffsets: cloneManualOffsets(),
    collapsedKeys: cloneCollapsedKeys(),
  };
}

function restoreSnapshot(snapshot) {
  state.tree = cloneTree(snapshot.tree);
  state.selectedId = snapshot.selectedId;
  state.layoutMode = normalizeLayoutMode(snapshot.layoutMode);
  state.labelMode = normalizeLabelMode(snapshot.labelMode);
  state.manualOffsets = cloneManualOffsets(snapshot.manualOffsets || new Map());
  state.collapsedKeys = cloneCollapsedKeys(snapshot.collapsedKeys || new Set());
  state.editingId = null;
  state.markdownDirty = false;
  localStorage.setItem(LAYOUT_MODE_KEY, state.layoutMode);
  localStorage.setItem(LABEL_MODE_KEY, state.labelMode);
  render();
  centerOnNode(state.selectedId, false);
}

function recordHistory() {
  state.history.past.push(createSnapshot());
  if (state.history.past.length > state.history.limit) {
    state.history.past.shift();
  }
  state.history.future = [];
}

function undo() {
  if (!state.history.past.length) {
    showMessage("戻せる操作がありません");
    return;
  }
  const current = createSnapshot();
  const previous = state.history.past.pop();
  state.history.future.push(current);
  restoreSnapshot(previous);
  showMessage("元に戻しました");
}

function redo() {
  if (!state.history.future.length) {
    showMessage("やり直せる操作がありません");
    return;
  }
  const current = createSnapshot();
  const next = state.history.future.pop();
  state.history.past.push(current);
  restoreSnapshot(next);
  showMessage("やり直しました");
}

function walk(node, visitor, parent = null, depth = 0, index = 0) {
  visitor(node, parent, depth, index);
  node.children.forEach((child, childIndex) => walk(child, visitor, node, depth + 1, childIndex));
}

function walkVisible(node, visitor, parent = null, depth = 0, index = 0) {
  visitor(node, parent, depth, index);
  if (isNodeCollapsed(node)) return;
  node.children.forEach((child, childIndex) => walkVisible(child, visitor, node, depth + 1, childIndex));
}

function rebuildParents() {
  state.parentById = new Map();
  walk(state.tree, (node, parent) => {
    if (parent) state.parentById.set(node.id, parent.id);
  });
}

function findNode(id, root = state.tree) {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(id, child);
    if (found) return found;
  }
  return null;
}

function getParent(id) {
  const parentId = state.parentById.get(id);
  return parentId ? findNode(parentId) : null;
}

function getOffsetKey(node) {
  if (!node || node.id === state.tree.id) return "";
  const path = getNumberPath(node.id);
  return path ? `${path}|${getNodeTitle(node)}` : "";
}

function getManualOffset(node) {
  const key = getOffsetKey(node);
  return key ? state.manualOffsets.get(key) : null;
}

function isNodeCollapsed(node) {
  const key = getOffsetKey(node);
  return Boolean(key && state.collapsedKeys.has(key));
}

function setNodeCollapsed(node, collapsed) {
  const key = getOffsetKey(node);
  if (!key) return;
  if (collapsed) state.collapsedKeys.add(key);
  else state.collapsedKeys.delete(key);
}

function getCurrentOffsetKeys() {
  const keys = new Set();
  walk(state.tree, (node) => {
    const key = getOffsetKey(node);
    if (key) keys.add(key);
  });
  return keys;
}

function pruneCollapsedKeys() {
  const keys = getCurrentOffsetKeys();
  [...state.collapsedKeys.keys()].forEach((key) => {
    if (!keys.has(key)) state.collapsedKeys.delete(key);
  });
}

function pruneManualOffsets() {
  const keys = getCurrentOffsetKeys();
  [...state.manualOffsets.keys()].forEach((key) => {
    if (!keys.has(key)) state.manualOffsets.delete(key);
  });
}

function saveCollapsedState() {
  pruneCollapsedKeys();
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...state.collapsedKeys]));
}

function saveManualOffsets() {
  pruneManualOffsets();
  const entries = [...state.manualOffsets.entries()]
    .filter(([, value]) => Math.abs(value.x) >= 0.5 || Math.abs(value.y) >= 0.5)
    .map(([key, value]) => [key, { x: Math.round(value.x), y: Math.round(value.y) }]);
  localStorage.setItem(POSITIONS_KEY, JSON.stringify(Object.fromEntries(entries)));
}

function isInSubtree(rootId, targetId) {
  const root = findNode(rootId);
  if (!root) return false;
  let found = false;
  walk(root, (node) => {
    if (node.id === targetId) found = true;
  });
  return found;
}

function canReparentNode(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId || sourceId === state.tree.id) return false;
  if (!findNode(sourceId) || !findNode(targetId)) return false;
  return !isInSubtree(sourceId, targetId);
}

function countNodes() {
  let count = 0;
  walk(state.tree, () => {
    count += 1;
  });
  return count;
}

function countVisibleNodes() {
  let count = 0;
  walkVisible(state.tree, () => {
    count += 1;
  });
  return count;
}

function countDescendants(node) {
  let count = 0;
  node.children.forEach((child) => {
    walk(child, () => {
      count += 1;
    });
  });
  return count;
}

function parseMarkdown(markdown) {
  const lines = String(markdown || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  let rootText = "新しいマインドマップ";
  let firstHeadingIndex = -1;

  for (const [index, line] of lines.entries()) {
    const heading = line.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      rootText = heading[1].trim();
      firstHeadingIndex = index;
      break;
    }
  }

  if (firstHeadingIndex === -1 && !lines.some((line) => /^(\s*)([-*+])\s+(.+)$/.test(line)) && lines.length) {
    const first = lines[0].replace(/^#+\s*/, "").trim();
    rootText = first || rootText;
  }

  const root = createNode(rootText);
  const stack = [{ indent: -1, node: root }];

  for (const [index, line] of lines.entries()) {
    if (index === firstHeadingIndex) continue;

    const quote = line.match(/^(\s*)>\s?(.*)$/);
    if (quote) {
      const quoteIndent = quote[1].replace(/\t/g, "  ").length;
      while (stack.length > 1 && quoteIndent <= stack[stack.length - 1].indent) {
        stack.pop();
      }
      appendNodeComment(stack[stack.length - 1].node, quote[2]);
      continue;
    }

    const bullet = line.match(/^(\s*)([-*+])\s+(.+)$/);
    if (bullet) {
      const indent = bullet[1].replace(/\t/g, "  ").length;
      const node = createNode(bullet[3].trim());
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
        stack.pop();
      }
      stack[stack.length - 1].node.children.push(node);
      stack.push({ indent, node });
      continue;
    }

    const plain = line.match(/^(\s*)(.+)$/);
    if (plain) {
      const indent = plain[1].replace(/\t/g, "  ").length;
      const node = createNode(plain[2].replace(/^#+\s*/, "").trim());
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
        stack.pop();
      }
      stack[stack.length - 1].node.children.push(node);
      stack.push({ indent, node });
    }
  }

  return root;
}

function toMarkdown(root) {
  const lines = [`# ${getNodeTitle(root)}`];
  getNodeComments(root).forEach((comment) => {
    lines.push(`> ${comment}`);
  });

  const writeChildren = (children, depth) => {
    children.forEach((child) => {
      const bulletIndent = "  ".repeat(depth);
      const commentIndent = "  ".repeat(depth + 1);
      lines.push(`${bulletIndent}- ${getNodeTitle(child)}`);
      getNodeComments(child).forEach((comment) => {
        lines.push(`${commentIndent}> ${comment}`);
      });
      writeChildren(child.children, depth + 1);
    });
  };
  writeChildren(root.children, 0);
  return lines.join("\n");
}

function splitRootChildren() {
  const left = [];
  const right = [];
  state.tree.children.forEach((child, index) => {
    if (index % 2 === 0) right.push(child);
    else left.push(child);
  });
  return { left, right };
}

function leafCount(node) {
  const ownRows = Math.max(1, Math.ceil(nodeHeight(node) / ROW_GAP));
  if (!node.children.length || isNodeCollapsed(node)) return ownRows;
  return Math.max(ownRows, node.children.reduce((sum, child) => sum + leafCount(child), 0));
}

function applyManualOffsets(layout) {
  walk(state.tree, (node) => {
    const offset = getManualOffset(node);
    if (!offset) return;
    const pos = layout.get(node.id);
    if (!pos) return;
    pos.x += offset.x;
    pos.y += offset.y;
  });
}

function layoutTree() {
  const layout = new Map();
  layout.set(state.tree.id, { x: CENTER_X, y: CENTER_Y, side: 0, depth: 0 });

  const assign = (node, side, depth, topY) => {
    const leaves = leafCount(node);
    const subtreeHeight = Math.max(1, leaves) * ROW_GAP;
    const x = CENTER_X + side * depth * LEVEL_GAP;
    const y = topY + subtreeHeight / 2;
    layout.set(node.id, { x, y, side, depth });
    if (isNodeCollapsed(node)) return;

    let cursor = topY;
    node.children.forEach((child) => {
      const childHeight = Math.max(1, leafCount(child)) * ROW_GAP;
      assign(child, side, depth + 1, cursor);
      cursor += childHeight;
    });
  };

  const assignSide = (nodes, side) => {
    const totalHeight = Math.max(1, nodes.reduce((sum, child) => sum + leafCount(child), 0)) * ROW_GAP;
    let cursor = CENTER_Y - totalHeight / 2;
    nodes.forEach((child) => {
      const childHeight = Math.max(1, leafCount(child)) * ROW_GAP;
      assign(child, side, 1, cursor);
      cursor += childHeight;
    });
  };

  if (state.layoutMode === "right") {
    assignSide(state.tree.children, 1);
  } else {
    const { left, right } = splitRootChildren();
    assignSide(right, 1);
    assignSide(left, -1);
  }
  applyManualOffsets(layout);
  state.layout = layout;
}

function render() {
  rebuildParents();
  layoutTree();
  const selected = findNode(state.selectedId) || state.tree;
  state.selectedId = selected.id;

  els.nodeLayer.replaceChildren();
  els.linkLayer.replaceChildren();
  els.linkLayer.setAttribute("viewBox", `0 0 ${SURFACE_WIDTH} ${SURFACE_HEIGHT}`);

  renderLinks(state.tree);
  renderNodes();

  syncMarkdownFromTree();
  const totalNodes = countNodes();
  const visibleNodes = countVisibleNodes();
  els.nodeCount.textContent = visibleNodes === totalNodes ? `${totalNodes}ノード` : `${visibleNodes}/${totalNodes}ノード`;
  updateLayoutModeControls();
  updateLabelModeControls();
  updateHistoryControls();
  updateView();
  saveLocal();
}

function renderLinks(node) {
  if (isNodeCollapsed(node)) return;
  const from = state.layout.get(node.id);
  node.children.forEach((child) => {
    const to = state.layout.get(child.id);
    if (!from || !to) return;
    const side = to.side || 1;
    const startX = from.x + side * nodeWidth(node) / 2;
    const endX = to.x - side * nodeWidth(child) / 2;
    const controlGap = Math.max(58, Math.abs(endX - startX) * 0.5);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      `M ${startX} ${from.y} C ${startX + side * controlGap} ${from.y}, ${endX - side * controlGap} ${to.y}, ${endX} ${to.y}`
    );
    path.setAttribute("class", child.id === state.selectedId ? "link is-selected" : "link");
    els.linkLayer.append(path);
    renderLinks(child);
  });
}

function nodeWidth(node) {
  if (node.id === state.tree.id) return 150;
  const longestLine = getDisplayLines(node).reduce((max, line) => Math.max(max, line.length), 0);
  return Math.min(240, Math.max(92, longestLine * 12 + 34));
}

function nodeHeight(node) {
  const commentCount = getNodeComments(node).length;
  const collapsedRows = isNodeCollapsed(node) && node.children.length ? 1 : 0;
  const base = node.id === state.tree.id ? 50 : 40;
  return Math.min(124, base + (commentCount ? 8 : 0) + Math.min(commentCount, 4) * 15 + collapsedRows * 16);
}

function getNumberPath(id) {
  const parts = [];
  let currentId = id;
  while (currentId && currentId !== state.tree.id) {
    const parent = getParent(currentId);
    if (!parent) break;
    const index = parent.children.findIndex((child) => child.id === currentId);
    if (index < 0) break;
    parts.unshift(index + 1);
    currentId = parent.id;
  }
  return parts.join(".");
}

function getDisplayTitle(node) {
  const title = getNodeTitle(node);
  if (state.labelMode !== "numbered" || node.id === state.tree.id) return title;
  const numberPath = getNumberPath(node.id);
  return numberPath ? `${numberPath}. ${title}` : title;
}

function getDisplayLines(node) {
  return [getDisplayTitle(node), ...getNodeComments(node)];
}

function renderNodes() {
  walkVisible(state.tree, (node) => {
    const pos = state.layout.get(node.id);
    if (!pos) return;
    const width = nodeWidth(node);
    const height = nodeHeight(node);
    const collapsed = isNodeCollapsed(node);
    const item = document.createElement("div");
    item.className = [
      "node",
      node.id === state.tree.id ? "is-root" : "",
      node.id === state.selectedId ? "is-selected" : "",
      node.id === state.editingId ? "is-editing" : "",
      collapsed ? "is-collapsed" : "",
    ]
      .filter(Boolean)
      .join(" ");
    item.style.width = `${width}px`;
    item.style.left = `${pos.x - width / 2}px`;
    item.style.minHeight = `${height}px`;
    item.style.top = `${pos.y - height / 2}px`;
    item.dataset.id = node.id;
    item.tabIndex = -1;
    item.setAttribute("role", "button");
    item.setAttribute("aria-pressed", node.id === state.selectedId ? "true" : "false");
    item.addEventListener("pointerdown", (event) => startNodeDrag(event, node, item));

    if (node.id === state.editingId) {
      const input = document.createElement("textarea");
      input.className = "node-edit";
      input.value = node.text;
      input.setAttribute("aria-label", "ノード名とコメント");
      setEditRows(input);
      input.addEventListener("compositionstart", () => {
        state.composing = true;
      });
      input.addEventListener("compositionend", () => {
        state.composing = false;
      });
      input.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      input.addEventListener("input", () => {
        setEditRows(input);
      });
      input.addEventListener("keydown", (event) => {
        if (shouldIgnoreShortcut(event)) return;
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          finishInlineEdit(input.value);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          state.editingId = null;
          render();
          focusCanvas();
        }
      });
      input.addEventListener("blur", () => {
        if (state.editingId === node.id) finishInlineEdit(input.value);
      });
      item.append(input);
      queueMicrotask(() => {
        input.focus();
        input.select();
      });
    } else {
      if (node.children.length) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "node-toggle";
        toggle.textContent = collapsed ? "+" : "−";
        toggle.title = collapsed ? "展開" : "折りたたみ";
        toggle.setAttribute("aria-label", `${getNodeTitle(node)}を${collapsed ? "展開" : "折りたたみ"}`);
        toggle.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        toggle.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleCollapsed(node.id);
        });
        item.append(toggle);
      }

      const label = document.createElement("span");
      label.className = "node-label";
      const title = document.createElement("span");
      title.className = "node-title";
      title.textContent = getDisplayTitle(node);
      label.append(title);
      getNodeComments(node).forEach((comment) => {
        const commentLine = document.createElement("span");
        commentLine.className = "node-comment";
        commentLine.textContent = comment;
        label.append(commentLine);
      });
      if (collapsed) {
        const meta = document.createElement("span");
        meta.className = "node-meta";
        meta.textContent = `${countDescendants(node)}項目を非表示`;
        label.append(meta);
      }
      item.append(label);
    }

    item.addEventListener("click", (event) => {
      if (state.suppressClick) {
        event.preventDefault();
        event.stopPropagation();
        state.suppressClick = false;
        return;
      }
      if (state.selectedId === node.id && !state.editingId) {
        focusCanvas();
        return;
      }
      selectNode(node.id);
    });
    item.addEventListener("dblclick", () => startInlineEdit(node.id));
    els.nodeLayer.append(item);
  });
}

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, toMarkdown(state.tree));
  saveManualOffsets();
  saveCollapsedState();
  els.saveStatus.textContent = state.markdownDirty ? "MD編集中" : "保存済み";
}

function syncMarkdownFromTree(force = false) {
  if (!force && state.markdownDirty) return;
  els.markdown.value = toMarkdown(state.tree);
  state.markdownDirty = false;
}

function updateLayoutModeControls() {
  els.layoutModeButtons.forEach((button) => {
    const active = button.dataset.layoutMode === state.layoutMode;
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function updateLabelModeControls() {
  els.labelModeButtons.forEach((button) => {
    const active = button.dataset.labelMode === state.labelMode;
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function updateHistoryControls() {
  if (els.undoButton) els.undoButton.disabled = state.history.past.length === 0;
  if (els.redoButton) els.redoButton.disabled = state.history.future.length === 0;
}

function setLayoutMode(mode) {
  const nextMode = normalizeLayoutMode(mode);
  if (state.layoutMode === nextMode) return;
  recordHistory();
  state.layoutMode = nextMode;
  localStorage.setItem(LAYOUT_MODE_KEY, nextMode);
  render();
  fitView();
  showMessage(nextMode === "right" ? "右方向モードにしました" : "左右モードにしました");
}

function setLabelMode(mode) {
  const nextMode = normalizeLabelMode(mode);
  if (state.labelMode === nextMode) return;
  recordHistory();
  state.labelMode = nextMode;
  localStorage.setItem(LABEL_MODE_KEY, nextMode);
  render();
  showMessage(nextMode === "numbered" ? "番号表示にしました" : "通常表示にしました");
}

function toggleCollapsed(id = state.selectedId) {
  const node = findNode(id);
  if (!node || !node.children.length) return;
  const nextCollapsed = !isNodeCollapsed(node);
  recordHistory();
  setNodeCollapsed(node, nextCollapsed);
  state.selectedId = node.id;
  state.editingId = null;
  render();
  centerOnNode(node.id, false);
  focusCanvas();
  showMessage(nextCollapsed ? "折りたたみました" : "展開しました");
}

function selectNode(id, shouldCenter = false) {
  if (!findNode(id)) return;
  state.selectedId = id;
  state.editingId = null;
  render();
  if (shouldCenter) centerOnNode(id);
  focusCanvas();
}

function startInlineEdit(id = state.selectedId) {
  if (!findNode(id)) return;
  state.selectedId = id;
  state.editingId = id;
  render();
}

function finishInlineEdit(value) {
  const node = findNode(state.editingId);
  if (node) {
    const nextText = normalizeNodeText(value) || "無題";
    if (node.text !== nextText) {
      recordHistory();
      node.text = nextText;
    }
  }
  state.editingId = null;
  render();
  focusCanvas();
}

function addChild() {
  const node = findNode(state.selectedId);
  if (!node) return;
  recordHistory();
  const child = createNode("新しいノード");
  node.children.push(child);
  setNodeCollapsed(node, false);
  state.selectedId = child.id;
  state.editingId = child.id;
  render();
  centerOnNode(child.id);
}

function addSibling() {
  const node = findNode(state.selectedId);
  const parent = getParent(state.selectedId);
  if (!node || !parent) {
    addChild();
    return;
  }
  recordHistory();
  const sibling = createNode("新しいノード");
  const index = parent.children.findIndex((child) => child.id === node.id);
  parent.children.splice(index + 1, 0, sibling);
  state.selectedId = sibling.id;
  state.editingId = sibling.id;
  render();
  centerOnNode(sibling.id);
}

function deleteSelected() {
  if (state.selectedId === state.tree.id) return;
  const parent = getParent(state.selectedId);
  if (!parent) return;
  recordHistory();
  const index = parent.children.findIndex((child) => child.id === state.selectedId);
  parent.children.splice(index, 1);
  const next = parent.children[Math.min(index, parent.children.length - 1)] || parent;
  state.selectedId = next.id;
  state.editingId = null;
  render();
  centerOnNode(next.id);
}

function moveSelected(offset) {
  const parent = getParent(state.selectedId);
  if (!parent) return;
  const index = parent.children.findIndex((child) => child.id === state.selectedId);
  const nextIndex = index + offset;
  if (nextIndex < 0 || nextIndex >= parent.children.length) return;
  recordHistory();
  const [node] = parent.children.splice(index, 1);
  parent.children.splice(nextIndex, 0, node);
  render();
  centerOnNode(node.id);
}

function indentSelected() {
  const parent = getParent(state.selectedId);
  if (!parent) return;
  const index = parent.children.findIndex((child) => child.id === state.selectedId);
  if (index <= 0) return;
  recordHistory();
  const [node] = parent.children.splice(index, 1);
  const nextParent = parent.children[index - 1];
  nextParent.children.push(node);
  setNodeCollapsed(nextParent, false);
  render();
  centerOnNode(node.id);
}

function outdentSelected() {
  const parent = getParent(state.selectedId);
  const grandParent = parent ? getParent(parent.id) : null;
  if (!parent || !grandParent) return;
  const index = parent.children.findIndex((child) => child.id === state.selectedId);
  const parentIndex = grandParent.children.findIndex((child) => child.id === parent.id);
  recordHistory();
  const [node] = parent.children.splice(index, 1);
  grandParent.children.splice(parentIndex + 1, 0, node);
  render();
  centerOnNode(node.id);
}

function reparentNode(sourceId, targetId) {
  if (!canReparentNode(sourceId, targetId)) return false;
  const source = findNode(sourceId);
  const currentParent = getParent(sourceId);
  const target = findNode(targetId);
  if (!source || !currentParent || !target || currentParent.id === target.id) return false;

  const sourceIndex = currentParent.children.findIndex((child) => child.id === sourceId);
  if (sourceIndex < 0) return false;
  recordHistory();
  const [moved] = currentParent.children.splice(sourceIndex, 1);
  target.children.push(moved);
  setNodeCollapsed(target, false);
  state.selectedId = moved.id;
  state.editingId = null;
  render();
  centerOnNode(moved.id);
  showMessage(`「${getNodeTitle(moved)}」を「${getNodeTitle(target)}」の下へ移動しました`);
  return true;
}

function getSubtreeIds(id) {
  const node = findNode(id);
  if (!node) return [];
  const ids = [];
  walk(node, (child) => {
    ids.push(child.id);
  });
  return ids;
}

function adjustNodeOffset(node, dx, dy) {
  const key = getOffsetKey(node);
  if (!key) return;
  const current = state.manualOffsets.get(key) || { x: 0, y: 0 };
  const next = { x: current.x + dx, y: current.y + dy };
  if (Math.abs(next.x) < 0.5 && Math.abs(next.y) < 0.5) {
    state.manualOffsets.delete(key);
  } else {
    state.manualOffsets.set(key, next);
  }
}

function moveNodeBranch(sourceId, dx, dy) {
  const source = findNode(sourceId);
  if (!source || source.id === state.tree.id || Math.hypot(dx, dy) < 1) return false;
  recordHistory();
  walk(source, (node) => {
    adjustNodeOffset(node, dx, dy);
  });
  state.selectedId = source.id;
  state.editingId = null;
  render();
  focusCanvas();
  showMessage(`「${getNodeTitle(source)}」の位置を移動しました`);
  return true;
}

function selectRelative(direction) {
  const node = findNode(state.selectedId);
  if (!node) return;
  if (direction === "parent") {
    const parent = getParent(node.id);
    if (parent) selectNode(parent.id, true);
    return;
  }
  if (direction === "child") {
    if (isNodeCollapsed(node) && node.children.length) {
      toggleCollapsed(node.id);
      return;
    }
    if (node.children[0]) selectNode(node.children[0].id, true);
    return;
  }

  const parent = getParent(node.id);
  if (!parent) return;
  const index = parent.children.findIndex((child) => child.id === node.id);
  const sibling = parent.children[index + (direction === "next" ? 1 : -1)];
  if (sibling) selectNode(sibling.id, true);
}

function applyMarkdown() {
  const next = parseMarkdown(els.markdown.value);
  if (toMarkdown(state.tree) !== toMarkdown(next)) {
    recordHistory();
  }
  state.tree = next;
  state.selectedId = next.id;
  state.editingId = null;
  state.markdownDirty = false;
  render();
  fitView();
  showMessage("Markdownを反映しました");
}

async function copyMarkdown() {
  const value = toMarkdown(state.tree);
  els.markdown.value = value;
  state.markdownDirty = false;
  saveLocal();
  els.markdown.select();
  try {
    await navigator.clipboard.writeText(value);
    showMessage("Markdownをコピーしました");
  } catch {
    document.execCommand("copy");
    showMessage("選択中のMarkdownをコピーしました");
  }
}

function showMessage(text) {
  els.messageLine.textContent = text;
  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => {
    els.messageLine.textContent = "";
  }, 2200);
}

function updateView() {
  els.surface.style.transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.zoom})`;
  const percent = `${Math.round(state.view.zoom * 100)}%`;
  document.querySelector('[data-action="reset-view"]').textContent = percent;
}

function zoomBy(delta, origin = null) {
  const oldZoom = state.view.zoom;
  const nextZoom = clamp(oldZoom + delta, MIN_ZOOM, MAX_ZOOM);
  if (nextZoom === oldZoom) return;

  const rect = els.viewport.getBoundingClientRect();
  const point = origin || { x: rect.width / 2, y: rect.height / 2 };
  const worldX = (point.x - state.view.x) / oldZoom;
  const worldY = (point.y - state.view.y) / oldZoom;

  state.view.zoom = nextZoom;
  state.view.x = point.x - worldX * nextZoom;
  state.view.y = point.y - worldY * nextZoom;
  updateView();
}

function resetView() {
  state.view.zoom = 1;
  centerOnNode(state.selectedId, false);
  updateView();
}

function centerOnNode(id, smooth = true) {
  const pos = state.layout.get(id);
  if (!pos) return;
  const rect = els.viewport.getBoundingClientRect();
  state.view.x = rect.width / 2 - pos.x * state.view.zoom;
  state.view.y = rect.height / 2 - pos.y * state.view.zoom;
  updateView();
  if (smooth) {
    els.surface.animate(
      [{ transform: els.surface.style.transform }],
      { duration: 130, easing: "ease-out" }
    );
  }
}

function fitView() {
  const positions = [...state.layout.values()];
  if (!positions.length) return;
  const padding = 180;
  const minX = Math.min(...positions.map((pos) => pos.x)) - padding;
  const maxX = Math.max(...positions.map((pos) => pos.x)) + padding;
  const minY = Math.min(...positions.map((pos) => pos.y)) - padding;
  const maxY = Math.max(...positions.map((pos) => pos.y)) + padding;
  const rect = els.viewport.getBoundingClientRect();
  const zoom = clamp(Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY)), MIN_ZOOM, 1.2);
  state.view.zoom = zoom;
  state.view.x = rect.width / 2 - ((minX + maxX) / 2) * zoom;
  state.view.y = rect.height / 2 - ((minY + maxY) / 2) * zoom;
  updateView();
}

function resetLayoutAndFitView() {
  pruneManualOffsets();
  if (!state.manualOffsets.size) {
    fitView();
    showMessage("全体表示にしました");
    return;
  }

  recordHistory();
  state.manualOffsets = new Map();
  localStorage.removeItem(POSITIONS_KEY);
  render();
  fitView();
  showMessage("配置をリセットして全体表示しました");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function focusCanvas() {
  queueMicrotask(() => els.viewport.focus({ preventScroll: true }));
}

function getNodeElement(id) {
  return els.nodeLayer.querySelector(`[data-id="${id}"]`);
}

function suppressNextNodeClick() {
  state.suppressClick = true;
  window.setTimeout(() => {
    state.suppressClick = false;
  }, 120);
}

function setNodeDropTarget(targetId) {
  if (!state.drag || state.drag.type !== "node" || state.drag.mode !== "reparent" || state.drag.dropTargetId === targetId) return;
  if (state.drag.dropTargetId) {
    getNodeElement(state.drag.dropTargetId)?.classList.remove("is-drop-target");
  }
  state.drag.dropTargetId = targetId;
  if (targetId) {
    getNodeElement(targetId)?.classList.add("is-drop-target");
  }
}

function getDragElements(drag) {
  const ids = drag.nodeIds || [drag.nodeId];
  return ids.map(getNodeElement).filter(Boolean);
}

function clearNodeDragVisual(drag = state.drag) {
  if (!drag || drag.type !== "node") return;
  if (drag.dropTargetId) {
    getNodeElement(drag.dropTargetId)?.classList.remove("is-drop-target");
  }
  getDragElements(drag).forEach((item) => {
    item.classList.remove("is-dragging");
    item.style.transform = "";
  });
  els.viewport.classList.remove("is-node-dragging");
}

function releaseNodePointerCapture(item, pointerId) {
  try {
    if (item?.hasPointerCapture?.(pointerId)) item.releasePointerCapture(pointerId);
  } catch {
    // The pointer may already be released by the browser after cancellation.
  }
}

function getDropTargetIdAtPoint(clientX, clientY, sourceId) {
  const element = document.elementFromPoint(clientX, clientY);
  const target = element?.closest?.(".node");
  const targetId = target?.dataset?.id || null;
  return canReparentNode(sourceId, targetId) ? targetId : null;
}

function startNodeDrag(event, node, item) {
  if (event.button !== 0 || node.id === state.tree.id || state.editingId || isTypingTarget(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  state.drag = {
    type: "node",
    mode: event.altKey ? "reparent" : "move",
    id: event.pointerId,
    nodeId: node.id,
    nodeIds: getSubtreeIds(node.id),
    startX: event.clientX,
    startY: event.clientY,
    item,
    active: false,
    dropTargetId: null,
  };
  item.setPointerCapture?.(event.pointerId);
}

function handleNodeDragMove(event) {
  if (!state.drag || state.drag.type !== "node" || state.drag.id !== event.pointerId) return;
  const drag = state.drag;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;

  if (!drag.active) {
    if (Math.hypot(dx, dy) < NODE_DRAG_THRESHOLD) return;
    drag.active = true;
    suppressNextNodeClick();
    getDragElements(drag).forEach((item) => item.classList.add("is-dragging"));
    els.viewport.classList.add("is-node-dragging");
  }

  event.preventDefault();
  const transform = `translate(${dx / state.view.zoom}px, ${dy / state.view.zoom}px)`;
  getDragElements(drag).forEach((item) => {
    item.style.transform = transform;
  });
  if (drag.mode === "reparent") {
    setNodeDropTarget(getDropTargetIdAtPoint(event.clientX, event.clientY, drag.nodeId));
  }
}

function finishNodeDrag(event) {
  if (!state.drag || state.drag.type !== "node") return;
  if (event.pointerId !== undefined && state.drag.id !== event.pointerId) return;
  const drag = state.drag;
  const wasActive = drag.active;
  const targetId = wasActive ? drag.dropTargetId || getDropTargetIdAtPoint(event.clientX, event.clientY, drag.nodeId) : null;
  clearNodeDragVisual(drag);
  state.drag = null;
  releaseNodePointerCapture(drag.item, event.pointerId);

  if (!wasActive) return;
  event.preventDefault();
  event.stopPropagation();
  suppressNextNodeClick();

  if (drag.mode === "move") {
    const dx = (event.clientX - drag.startX) / state.view.zoom;
    const dy = (event.clientY - drag.startY) / state.view.zoom;
    if (!moveNodeBranch(drag.nodeId, dx, dy)) {
      render();
      focusCanvas();
    }
    return;
  }

  if (!targetId || !reparentNode(drag.nodeId, targetId)) {
    state.selectedId = drag.nodeId;
    state.editingId = null;
    render();
    focusCanvas();
  }
}

function cancelNodeDrag(event) {
  if (!state.drag || state.drag.type !== "node") return;
  const drag = state.drag;
  const wasActive = drag.active;
  clearNodeDragVisual(drag);
  state.drag = null;
  releaseNodePointerCapture(drag.item, event?.pointerId);
  if (wasActive) {
    suppressNextNodeClick();
    state.selectedId = drag.nodeId;
    state.editingId = null;
    render();
    focusCanvas();
  }
}

function shouldIgnoreShortcut(event) {
  return state.composing || event.isComposing || event.keyCode === 229 || event.key === "Process";
}

function isTypingTarget(target) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

function handleGlobalKeydown(event) {
  if (shouldIgnoreShortcut(event)) return;

  if (state.drag?.type === "node" && event.key === "Escape") {
    event.preventDefault();
    cancelNodeDrag(event);
    return;
  }

  const typing = isTypingTarget(event.target);
  const meta = event.metaKey || event.ctrlKey;

  if (typing) return;

  if (meta && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }

  if (meta && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }

  if (meta && event.key.toLowerCase() === "c") {
    event.preventDefault();
    copyMarkdown();
    return;
  }

  if (meta && event.key.toLowerCase() === "m") {
    event.preventDefault();
    els.markdown.focus();
    els.markdown.select();
    return;
  }

  switch (event.key) {
    case "Enter":
      event.preventDefault();
      if (event.shiftKey) addChild();
      else if (event.metaKey || event.ctrlKey) addSibling();
      else startInlineEdit();
      break;
    case "Tab":
      event.preventDefault();
      if (event.shiftKey) outdentSelected();
      else if (event.altKey) indentSelected();
      else addChild();
      break;
    case "Backspace":
    case "Delete":
      event.preventDefault();
      deleteSelected();
      break;
    case "F2":
      event.preventDefault();
      startInlineEdit();
      break;
    case " ":
      event.preventDefault();
      toggleCollapsed();
      break;
    case "Escape":
      event.preventDefault();
      focusCanvas();
      break;
    case "ArrowUp":
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) moveSelected(-1);
      else selectRelative("previous");
      break;
    case "ArrowDown":
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) moveSelected(1);
      else selectRelative("next");
      break;
    case "ArrowLeft":
      event.preventDefault();
      selectRelative("parent");
      break;
    case "ArrowRight":
      event.preventDefault();
      selectRelative("child");
      break;
    case "+":
    case "=":
      if (meta) {
        event.preventDefault();
        zoomBy(0.1);
      }
      break;
    case "-":
      if (meta) {
        event.preventDefault();
        zoomBy(-0.1);
      }
      break;
    case "0":
      if (meta) {
        event.preventDefault();
        resetView();
      }
      break;
  }
}

function handleAction(action) {
  const actions = {
    undo,
    redo,
    "add-child": addChild,
    "add-sibling": addSibling,
    "delete-node": deleteSelected,
    "zoom-out": () => zoomBy(-0.1),
    "zoom-in": () => zoomBy(0.1),
    "reset-view": resetView,
    "fit-view": resetLayoutAndFitView,
    "copy-markdown": copyMarkdown,
    "apply-markdown": applyMarkdown,
  };
  actions[action]?.();
}

document.addEventListener("keydown", handleGlobalKeydown);
document.addEventListener("pointermove", handleNodeDragMove);
document.addEventListener("pointerup", finishNodeDrag);
document.addEventListener("pointercancel", cancelNodeDrag);
document.addEventListener("mouseup", finishNodeDrag);
window.addEventListener("blur", cancelNodeDrag);
document.addEventListener("compositionstart", () => {
  state.composing = true;
});
document.addEventListener("compositionend", () => {
  state.composing = false;
});

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => handleAction(button.dataset.action));
});

els.layoutModeButtons.forEach((button) => {
  button.addEventListener("click", () => setLayoutMode(button.dataset.layoutMode));
});

els.labelModeButtons.forEach((button) => {
  button.addEventListener("click", () => setLabelMode(button.dataset.labelMode));
});

els.markdown.addEventListener("compositionstart", () => {
  state.composing = true;
});
els.markdown.addEventListener("compositionend", () => {
  state.composing = false;
});
els.markdown.addEventListener("input", () => {
  state.markdownDirty = true;
  els.saveStatus.textContent = "MD編集中";
});
els.markdown.addEventListener("keydown", (event) => {
  if (shouldIgnoreShortcut(event)) return;
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    applyMarkdown();
    focusCanvas();
  }
  if (event.key === "Tab") {
    event.preventDefault();
    const start = els.markdown.selectionStart;
    const end = els.markdown.selectionEnd;
    els.markdown.setRangeText("  ", start, end, "end");
  }
});

els.viewport.addEventListener("wheel", (event) => {
  if (!(event.metaKey || event.ctrlKey)) return;
  event.preventDefault();
  const rect = els.viewport.getBoundingClientRect();
  zoomBy(event.deltaY < 0 ? 0.08 : -0.08, {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  });
}, { passive: false });

els.viewport.addEventListener("pointerdown", (event) => {
  if (state.drag || event.button !== 0 || event.target.closest(".node")) return;
  els.viewport.setPointerCapture(event.pointerId);
  state.drag = {
    type: "pan",
    id: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    viewX: state.view.x,
    viewY: state.view.y,
  };
  els.viewport.classList.add("is-panning");
});

els.viewport.addEventListener("pointermove", (event) => {
  if (!state.drag || state.drag.type !== "pan" || state.drag.id !== event.pointerId) return;
  state.view.x = state.drag.viewX + event.clientX - state.drag.startX;
  state.view.y = state.drag.viewY + event.clientY - state.drag.startY;
  updateView();
});

els.viewport.addEventListener("pointerup", (event) => {
  if (!state.drag || state.drag.type !== "pan" || state.drag.id !== event.pointerId) return;
  state.drag = null;
  els.viewport.classList.remove("is-panning");
});

els.viewport.addEventListener("pointercancel", (event) => {
  if (!state.drag || state.drag.type !== "pan" || state.drag.id !== event.pointerId) return;
  state.drag = null;
  els.viewport.classList.remove("is-panning");
});

window.addEventListener("resize", () => {
  centerOnNode(state.selectedId, false);
});

render();
fitView();
