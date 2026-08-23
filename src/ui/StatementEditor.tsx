// Copyright (C) 2025-2026 Tuack-GUI Develop Team.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { Save } from "lucide-react";
import { Button } from "../components/ui/button";
import { readTextFile, writeTextFile } from "../ipc";
import { reportError } from "../errors";
import { isActiveSide, lockSide, releaseLock, type SyncSide } from "../lib/syncLock";
import type { AppTheme } from "../theme";

export interface StatementEditorHandle {
  /** 预览滚动联动：编辑器滚动到模板行顶部（不移动光标） */
  scrollToSource: (line: number) => void;
}

interface Props {
  /** 题目目录，编辑 <dir>/statement.md */
  dir: string;
  theme: AppTheme;
  /** 刷新预览（写入文件后调用，preview 轻量可实时跟随） */
  onRender: () => void;
  /** 编辑器光标/滚动所在模板行变化（供预览联动）；ratio = 该行在编辑器视口中的位置比例（0~1），animated = 是否平滑动画 */
  onCursorLine: (line: number, ratio: number, animated: boolean) => void;
  ref?: Ref<StatementEditorHandle>;
}

/** 输入后自动保存的防抖间隔（ms） */
const AUTO_SAVE_DELAY = 100;

/** 题面 Markdown 编辑器：CodeMirror + Ctrl/S 保存，输入后防抖自动保存并刷新预览 */
export default function StatementEditor({ dir, theme, onRender, onCursorLine, ref }: Props) {
  const path = `${dir}/statement.md`;
  /** CodeMirror 视图引用：保存时直接读编辑器里的真实文档，绕开受控值同步竞态 */
  const viewRef = useRef<EditorView | null>(null);
  const saveTimer = useRef<number | null>(null);
  const lastCursorLine = useRef<number | null>(null);
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  /** 用户滚动来源：加锁标记。滚动条拖动（pointerdown）由 pointerup 释放；
   *  滚轮/触控板（wheel）由 scrollend 释放 */
  const SIDE: SyncSide = "editor";
  /** 拖动滚动条期间：scrollend 会误判"停止"提前释放锁，须屏蔽 */
  const pointerDragging = useRef(false);
  const handleUserPointerDown = () => {
    lockSide(SIDE);
    pointerDragging.current = true;
    const release = () => {
      pointerDragging.current = false;
      releaseLock(SIDE);
    };
    window.addEventListener("pointerup", release, { once: true });
    window.addEventListener("pointercancel", release, { once: true });
  };
  const handleUserWheel = () => {
    lockSide(SIDE);
  };
  const handleScrollEnd = () => {
    if (pointerDragging.current) return; // 拖动中不释放
    releaseLock(SIDE);
  };

  // 预览滚动联动：编辑器瞬时滚动到目标模板行顶部（滚动跟手，不移动光标）
  useImperativeHandle(
    ref,
    () => ({
      scrollToSource: (target: number) => {
        const view = viewRef.current;
        if (!view) return;
        const line = Math.min(Math.max(target, 1), view.state.doc.lines);
        const pos = view.state.doc.line(line).from;
        const block = view.lineBlockAt(pos);
        view.scrollDOM.scrollTop = block.top;
      },
    }),
    [],
  );

  // 光标行回调（用 ref 保持最新，供监听扩展/滚动监听调用）
  const cursorCb = useRef(onCursorLine);
  cursorCb.current = onCursorLine;

  /** 光标行在编辑器视口中的相对位置比例（0=顶部，1=底部） */
  const lineRatio = (view: EditorView, pos: number): number => {
    const block = view.lineBlockAt(pos);
    const clientH = view.scrollDOM.clientHeight;
    if (clientH <= 0) return 0;
    // block.top 为文档坐标，scrollTop 为视口顶部文档坐标，差即行相对视口顶部的距离
    return Math.min(1, Math.max(0, (block.top - view.scrollDOM.scrollTop) / clientH));
  };

  /** 编辑器滚动（滚动条/滚轮）→ 顶部可见行 → 预览跟随（实时，行号去重）
   *  注：用 DOM scroll 监听（@uiw 下 EditorView.scrollHandler 不触发） */
  const handleEditorScroll = () => {
    const view = viewRef.current;
    if (!view || !isActiveSide(SIDE)) return;
    // scrollTop 即文档高度坐标：视口顶部的行块
    const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
    const line = block ? view.state.doc.lineAt(block.from).number : 1;
    const ratio = block ? (block.top - view.scrollDOM.scrollTop) / view.scrollDOM.clientHeight : 0;
    if (line !== lastCursorLine.current) {
      lastCursorLine.current = line;
      // 滚动方向：瞬时跟随（不带动画）
      cursorCb.current(line, Math.min(1, Math.max(0, ratio)), false);
    }
  };

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    readTextFile(path)
      .then((c) => {
        if (!alive) return;
        setContent(c);
        setMissing(false);
        setDirty(false);
        setLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        setContent("");
        setMissing(true);
        setDirty(false);
        setLoaded(true);
      });
    return () => {
      alive = false;
      if (saveTimer.current != null) {
        // 切换视图 / 切题导致卸载：flush 尚未触发的自动保存，避免最后一步丢失
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        const text = viewRef.current?.state.doc.toString();
        if (text != null) void writeTextFile(path, text);
      }
    };
  }, [path]);

  /** 写入文件并刷新预览 */
  async function persist(text: string) {
    try {
      await writeTextFile(path, text);
      // 仅在保存期间无新输入时标记已保存；有新输入则保持脏状态，等待下一次防抖持久化
      if (viewRef.current?.state.doc.toString() === text) {
        setDirty(false);
      }
      onRender();
    } catch (e) {
      reportError(`保存题面失败：${e}`);
    }
  }

  /** 手动保存：清掉待执行的防抖自动保存，立即写入 */
  async function save() {
    if (saving || !loaded) return;
    if (saveTimer.current != null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setSaving(true);
    try {
      const text = viewRef.current?.state.doc.toString() ?? content;
      await persist(text);
    } finally {
      setSaving(false);
    }
  }

  /** 实时更新：输入后防抖自动保存 + 刷新预览 */
  function handleChange(v: string) {
    setContent(v);
    setDirty(true);
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      const text = viewRef.current?.state.doc.toString() ?? v;
      void persist(text);
    }, AUTO_SAVE_DELAY);
  }

  // 光标行监听：仅在光标真正切换行时上报
  const cursorListener = useMemo(
    () =>
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet && !update.docChanged) return;
        const head = update.state.selection.main.head;
        const line = update.state.doc.lineAt(head).number;
        const ratio = lineRatio(update.view, head);
        if (line !== lastCursorLine.current) {
          lastCursorLine.current = line;
          // 光标定位：平滑动画
          cursorCb.current(line, ratio, true);
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const status = saving ? "保存中…" : dirty ? "未保存" : "已保存";

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          save();
        }
      }}
    >
      <div
        className="flex h-9 shrink-0 items-center gap-3 px-3"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <span className="text-xs" style={{ color: "var(--foreground)" }}>
          statement.md
        </span>
        <span
          className="text-xs"
          style={{ color: dirty ? "var(--primary)" : "var(--muted-foreground)" }}
        >
          {dirty ? "● " : ""}
          {status}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <Button
            variant="default"
            size="sm"
            onClick={save}
            disabled={saving || !loaded}
          >
            <Save className="mr-1 h-3.5 w-3.5" />
            保存
          </Button>
        </div>
      </div>
      {missing && (
        <div
          className="shrink-0 px-3 py-1.5 text-xs"
          style={{ color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}
        >
          statement.md 不存在，保存时将创建
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {content.length > 50 * 1024 ? (
          <div
            className="flex h-full items-center justify-center p-4 text-xs"
            style={{ color: "var(--muted-foreground)" }}
          >
            题面过大（&gt;50KB），已拒绝加载编辑器。
          </div>
        ) : (
          <CodeMirror
            key={dir}
            value={content}
            onCreateEditor={(view) => {
              viewRef.current = view;
              // 编辑器滚动（滚动条/滚轮）→ 顶部可见行 → 预览跟随
              view.scrollDOM.addEventListener("scroll", handleEditorScroll);
              // 用户滚动来源：加锁；滚动真正停止（scrollend）释放
              view.scrollDOM.addEventListener("wheel", handleUserWheel);
              view.scrollDOM.addEventListener("pointerdown", handleUserPointerDown);
              view.scrollDOM.addEventListener("scrollend", handleScrollEnd);
            }}
            onChange={(v) => {
              handleChange(v);
            }}
            // 文件读完前禁编辑，避免加载回写覆盖刚输入的内容
            editable={loaded}
            // 题面是长段落文本：软折行，编辑器宽度锁死，不随行宽横向增长
            extensions={[markdown(), EditorView.lineWrapping, cursorListener]}
            theme={theme}
            height="100%"
            style={{ fontSize: 13, position: "absolute", inset: 0 }}
          />
        )}
      </div>
    </div>
  );
}
