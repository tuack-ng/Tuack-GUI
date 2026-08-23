// Copyright (C) 2025-2026 Tuack-GUI Develop Team.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from "react";
import { Database, Eye, EyeOff, FileText, Gauge, Settings, type LucideIcon } from "lucide-react";
import ConfigEditor from "./ConfigEditor";
import PreviewPane, { type PreviewPaneHandle } from "./PreviewPane";
import StatementEditor, { type StatementEditorHandle } from "./StatementEditor";
import JudgeView, { type JudgeTrigger } from "./JudgeView";
import DataPanel from "./DataPanel";
import type { NodeKind, Project } from "../ipc/types";
import type { AppTheme } from "../theme";
import { session } from "../rpc/session";

interface Props {
  project: Project | null;
  selected: { dir: string; kind: NodeKind } | null;
  theme: AppTheme;
  running: boolean;
  /** 已解析默认值的 ren 模板，预览据此探测 statements/<template>/ */
  template: string;
  /** ren 成功后自增，触发预览重新探测 */
  refreshKey: number;
  onRender: () => void;
  /** 评测触发（命令面板 test 命令）：dir 匹配时切换到评测视图 */
  judgeTrigger: JudgeTrigger | null;
  /** 数据生成完成后刷新工程树 */
  onProjectRefresh?: () => void;
}

/** 低于该宽度时配置 / 编辑 / 预览退化为切换 tab（类比 Qt resizeEvent 动态换布局） */
const SPLIT_WIDTH = 880;

type MainView = "config" | "edit" | "preview" | "judge" | "data";

export default function MainPanel({
  project,
  selected,
  theme,
  running,
  template,
  refreshKey,
  onRender,
  judgeTrigger,
  onProjectRefresh,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [view, setView] = useState<MainView>("config");
  /** 宽屏下右栏预览是否展开（可手动折叠；非编辑界面自动折叠） */
  const [previewOpen, setPreviewOpen] = useState(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setNarrow((entries[0]?.contentRect.width ?? 0) < SPLIT_WIDTH);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 变宽后「预览」不再作为左栏视图：预览常驻右栏
  useEffect(() => {
    if (!narrow && view === "preview") setView("config");
  }, [narrow, view]);

  // 切到无「编辑/评测」界面的节点（天/比赛）时回到配置页，避免 view 停留在不存在的页
  useEffect(() => {
    if (selected?.kind !== "problem") setView("config");
  }, [selected?.kind]);

  // 非编辑界面自动折叠预览；进入编辑界面自动展开（题目有编辑界面时才生效；场次等无编辑界面的节点预览常驻）
  useEffect(() => {
    const isProblem = selected?.kind === "problem";
    if (isProblem) {
      setPreviewOpen(view === "edit");
    } else {
      setPreviewOpen(true);
    }
  }, [selected, view]);

  // 命令面板 test 命令：切到评测视图
  useEffect(() => {
    if (judgeTrigger && selected && judgeTrigger.dir === selected.dir) {
      setView("judge");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [judgeTrigger]);

  const showPreview = selected != null && selected.kind !== "contest";

  const config = selected ? (
    <ConfigEditor
      dir={selected.dir}
      kind={selected.kind}
      theme={theme}
      narrow={narrow}
    />
  ) : null;

  // 编辑器 ↔ 预览同步滚动：ref 直接调用，绕过 React 状态链（响应更快）
  const editorRef = useRef<StatementEditorHandle>(null);
  const previewRef = useRef<PreviewPaneHandle>(null);

  const editor = selected && selected.kind === "problem" ? (
    <StatementEditor
      ref={editorRef}
      dir={selected.dir}
      onRender={onRender}
      theme={theme}
      onCursorLine={(line, ratio, animated) =>
        previewRef.current?.scrollToLine(line, ratio, animated)
      }
    />
  ) : null;

  const judgeView = selected && selected.kind === "problem" ? (
    <JudgeView dir={selected.dir} trigger={judgeTrigger} />
  ) : null;

  const preview = selected && showPreview ? (
    <PreviewPane
      ref={previewRef}
      scope={session.scope(selected.dir)}
      template={template}
      refreshKey={refreshKey}
      running={running}
      onRender={onRender}
      bordered={!narrow}
      onPreviewScroll={(source) => editorRef.current?.scrollToSource(source)}
    />
  ) : null;

  if (!selected) {
    return (
      <main ref={containerRef} className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          {project ? (
            <>
              <h1 className="text-xl font-semibold" style={{ color: "var(--foreground)" }}>
                {project.contest.title || project.contest.name}
              </h1>
              <p className="text-xs break-all" style={{ color: "var(--muted-foreground)" }}>
                {project.root}
              </p>
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                在左侧选择一个比赛 / 场次 / 题目以编辑其配置
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold" style={{ color: "var(--foreground)" }}>
                Tuack-GUI
              </h1>
              <p style={{ color: "var(--muted-foreground)" }}>美观、跨平台的 Tuack-NG 图形化前端</p>
            </>
          )}
        </div>
      </main>
    );
  }

  // 比赛根节点：只有配置，无编辑/预览
  if (!showPreview) {
    return (
      <main ref={containerRef} className="flex min-h-0 flex-1 flex-col">
        {config}
      </main>
    );
  }

  // 宽屏隐藏「预览」项（预览常驻右栏）；窄屏全显；
  // 场次节点无单一题面源，不出「编辑」项
  const isProblem = selected.kind === "problem";
  const views: { id: MainView; label: string; icon: LucideIcon }[] = [
    { id: "config", label: "配置", icon: Settings },
    ...(isProblem ? ([{ id: "edit", label: "编辑", icon: FileText }] as const) : []),
    ...(isProblem ? ([{ id: "judge", label: "评测", icon: Gauge }] as const) : []),
    ...(isProblem ? ([{ id: "data", label: "数据", icon: Database }] as const) : []),
    ...(narrow ? ([{ id: "preview", label: "预览", icon: Eye }] as const) : []),
  ];

  const dataView = isProblem ? (
    <DataPanel dir={selected.dir} theme={theme} onProjectRefresh={onProjectRefresh} />
  ) : null;

  const leftContent =
    view === "edit"
      ? editor
      : view === "judge"
        ? judgeView
        : view === "data"
          ? dataView
          : config;

  return (
    <main ref={containerRef} className="flex min-h-0 flex-1 flex-col">
      {views.length > 1 && (
        <div
          className="flex shrink-0 items-center gap-1 px-3 py-2"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          {views.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className="flex items-center gap-1 rounded px-3 py-1 text-xs"
              style={
                view === v.id
                  ? { backgroundColor: "var(--primary)", color: "#fff" }
                  : { color: "var(--muted-foreground)" }
              }
            >
              <v.icon size={14} />
              {v.label}
            </button>
          ))}
          {/* 预览展开/折叠按钮：常驻 tab 栏右侧（窄屏用「预览」tab 切换，不重复） */}
          {!narrow && isProblem && (
            <div className="ml-auto">
              <button
                onClick={() => setPreviewOpen((o) => !o)}
                className="flex items-center gap-1 rounded px-3 py-1 text-xs"
                style={
                  previewOpen
                    ? { backgroundColor: "var(--primary)", color: "#fff" }
                    : { color: "var(--muted-foreground)" }
                }
                title={previewOpen ? "收起预览" : "展开预览"}
              >
                {previewOpen ? <Eye size={14} /> : <EyeOff size={14} />}
                预览
              </button>
            </div>
          )}
        </div>
      )}
      {narrow ? (
        <div className="min-h-0 flex-1">
          {view === "config"
            ? config
            : view === "edit"
              ? editor
              : view === "judge"
                ? judgeView
                : view === "data"
                  ? dataView
                  : preview}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* 列容器必须是 flex-col：ConfigEditor 根部的 flex-1 依赖 flex 父级
              才拿到确定高度，否则高度塌成内容高，内部滚动全部失效 */}
          <div className="flex min-w-0 flex-col overflow-hidden" style={{ flex: "50 1 0%" }}>
            {leftContent}
          </div>
          {previewOpen && (
            <div className="flex min-w-0 flex-col overflow-hidden" style={{ flex: "50 1 0%" }}>
              {preview}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
