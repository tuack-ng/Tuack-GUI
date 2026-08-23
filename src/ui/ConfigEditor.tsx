// Copyright (C) 2025-2026 Tuack-GUI Develop Team.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";

import { useEffect, useState } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { getRenDefaults, setRenProject } from "../ipc";
import { reportError } from "../errors";
import { session, RpcSessionManager } from "../rpc/session";
import type { NodeKind } from "../ipc/types";
import type { AppTheme } from "../theme";
import { TEMPLATES } from "../templates";
import Select from "./Select";
import Checkbox from "./Checkbox";
import TestDataEditor from "./TestDataEditor";
import CheckerEditor from "./CheckerEditor";
import DateTimePicker from "./DateTimePicker";

type FieldType = "text" | "number" | "bool" | "enum" | "json" | "datetime";

interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  /** 与 options 对齐的显示标签（本地化） */
  labels?: string[];
}

const FIELDS: Record<NodeKind, FieldDef[]> = {
  contest: [
    { key: "name", label: "名称", type: "text" },
    { key: "title", label: "标题", type: "text" },
    { key: "short title", label: "副标题", type: "text" },
    { key: "use_pretest", label: "使用预测试", type: "bool" },
    { key: "noi_style", label: "NOI 风格", type: "bool" },
    { key: "file_io", label: "文件 IO", type: "bool" },
  ],
  day: [
    { key: "name", label: "名称", type: "text" },
    { key: "title", label: "标题", type: "text" },
    { key: "start time", label: "开始时间", type: "datetime" },
    { key: "end time", label: "结束时间", type: "datetime" },
    { key: "use_pretest", label: "使用预测试", type: "bool" },
    { key: "noi_style", label: "NOI 风格", type: "bool" },
    { key: "file_io", label: "文件 IO", type: "bool" },
  ],
  problem: [
    { key: "name", label: "名称", type: "text" },
    { key: "title", label: "标题", type: "text" },
    { key: "type", label: "类型", type: "enum", options: ["program", "output", "interactive"], labels: ["传统题", "提交答案题", "交互题"] },
    { key: "time limit", label: "时间限制（秒）", type: "number" },
    { key: "memory limit", label: "内存限制", type: "text" },
    { key: "dmk", label: "数据生成", type: "enum", options: ["skip", "input", "output", "on"], labels: ["忽略", "只生成输入", "只生成输出", "启用"] },
  ],
};

function toDisplay(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

interface Props {
  dir: string;
  kind: NodeKind;
  theme: AppTheme;
  /** 窄屏模式：透传给测试点编辑器以隐藏行操作栏 */
  narrow?: boolean;
}

export default function ConfigEditor({ dir, kind, theme, narrow = false }: Props) {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [tab, setTab] = useState<"form" | "json" | "data" | "gui">("form");
  const [jsonText, setJsonText] = useState("");
  const [status, setStatus] = useState("");
  const [renProject, setRenProjectState] = useState("");

  // 节点类型变化时重置到表单页（题目↔天/比赛）；同级别切换保留当前页
  useEffect(() => {
    setTab("form");
  }, [kind]);

  useEffect(() => {
    let alive = true;
    setStatus("");
    session
      .getConfig(dir)
      .then(({ config }) => {
        if (!alive) return;
        setConfig(config);
        setJsonText(JSON.stringify(config, null, 2));
      })
      .catch((e) => {
        if (alive) setStatus(String(e));
      });
    if (kind === "contest") {
      // 项目级 GUI 配置（存于项目根 .tuack-gui.json）
      getRenDefaults(dir)
        .then((d) => setRenProjectState(d.project ?? ""))
        .catch((e) => reportError(`读取项目 ren 模板失败：${e}`));
    }
    return () => {
      alive = false;
    };
  }, [dir, kind]);

  function setField(key: string, value: unknown) {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  /** 保存后的统一处理：revision 冲突时重载配置并提示 */
  function handleSaveError(e: unknown) {
    if (RpcSessionManager.isRevisionConflict(e)) {
      setStatus("保存冲突：配置已被其他程序修改，已重新加载");
      session
        .getConfig(dir)
        .then(({ config }) => {
          setConfig(config);
          setJsonText(JSON.stringify(config, null, 2));
        })
        .catch(() => {});
    } else {
      setStatus(String(e));
    }
  }

  async function saveForm() {
    if (!config) return;
    try {
      await session.setConfig(dir, config);
      setStatus("已保存");
    } catch (e) {
      handleSaveError(e);
    }
  }

  async function saveJson() {
    try {
      const parsed = JSON.parse(jsonText);
      await session.setConfig(dir, parsed);
      setStatus("已保存");
    } catch (e) {
      if (e instanceof SyntaxError) {
        setStatus("JSON 无效：" + String(e));
      } else {
        handleSaveError(e);
      }
    }
  }

  function handleTab(v: string) {
    if (v === "json" && config) setJsonText(JSON.stringify(config, null, 2));
    setTab(v as "form" | "json" | "data" | "gui");
  }

  return (
    <Tabs value={tab} onValueChange={handleTab} className="flex min-h-0 flex-1 flex-col">
      <div
        className="flex shrink-0 items-center gap-3 border-b px-4 py-2"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="text-xs uppercase" style={{ color: "var(--muted-foreground)" }}>
          {kind}
        </span>
        <TabsList>
          <TabsTrigger value="form">表单</TabsTrigger>
          {kind === "problem" && <TabsTrigger value="data">测试点</TabsTrigger>}
          <TabsTrigger value="json">高级 JSON</TabsTrigger>
          {kind === "contest" && <TabsTrigger value="gui">偏好</TabsTrigger>}
        </TabsList>
        <span
          className="ml-auto text-xs"
          style={{
            color: status.startsWith("已保存")
              ? "var(--success)"
              : status
                ? "var(--destructive)"
                : "var(--muted-foreground)",
          }}
        >
          {status}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <TabsContent value="form" className="h-full min-h-0">
          {config ? (
            <div className="flex max-w-md flex-col gap-3">
              {FIELDS[kind].map((f) => {
                const raw = config[f.key];
                if (f.type === "bool") {
                  return (
                    <Checkbox
                      key={f.key}
                      checked={!!raw}
                      onChange={(v) => setField(f.key, v)}
                      label={f.label}
                    />
                  );
                }
                return (
                  <div key={f.key} className="flex flex-col gap-1">
                    <Label>{f.label}</Label>
                    {f.type === "enum" ? (
                      <Select
                        value={String(raw ?? "")}
                        options={(f.options ?? []).map((o, i) => ({
                          value: o,
                          label: f.labels?.[i] ?? o,
                        }))}
                        onChange={(v) => setField(f.key, v)}
                      />
                    ) : f.type === "number" ? (
                      <Input
                        type="number"
                        step="any"
                        value={raw === null || raw === undefined ? "" : Number(raw)}
                        onChange={(e) =>
                          setField(f.key, e.target.value === "" ? null : Number(e.target.value))
                        }
                      />
                    ) : f.type === "datetime" ? (
                      <DateTimePicker
                        value={Array.isArray(raw) ? raw : undefined}
                        onChange={(v) => setField(f.key, v)}
                      />
                    ) : f.type === "json" ? (
                      <Input
                        type="text"
                        value={toDisplay(raw)}
                        onChange={(e) => {
                          const t = e.target.value;
                          try {
                            setField(f.key, JSON.parse(t));
                          } catch {
                            setField(f.key, t);
                          }
                        }}
                      />
                    ) : (
                      <Input
                        type="text"
                        value={raw === null || raw === undefined ? "" : String(raw)}
                        onChange={(e) => setField(f.key, e.target.value)}
                      />
                    )}
                  </div>
                );
              })}
              {kind === "problem" && (
                <>
                  <CheckerEditor
                    title="checker（校验器）"
                    value={config?.["checker"]}
                    onChange={(v) => setField("checker", v)}
                  />
                  <CheckerEditor
                    title="validator（数据校验器）"
                    value={config?.["validator"]}
                    onChange={(v) => setField("validator", v)}
                  />
                </>
              )}
              <Button variant="default" className="self-start" onClick={saveForm}>
                保存
              </Button>
            </div>
          ) : (
            <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              加载中…
            </div>
          )}
        </TabsContent>
        <TabsContent value="data" className="h-full min-h-0">
          <div className="flex min-h-0 flex-col gap-2">
            <div className="min-h-0 flex-1 overflow-auto">
              <TestDataEditor
                value={config?.["data"]}
                onChange={(v) => setField("data", v)}
                subtasks={
                  config?.["subtasks"] && typeof config["subtasks"] === "object"
                    ? (config["subtasks"] as Record<string, string>)
                    : undefined
                }
                onSubtasksChange={(v) => setField("subtasks", v)}
                narrow={narrow}
              />
            </div>
            <Button variant="default" className="self-start" onClick={saveForm}>
              保存
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="json" className="h-full min-h-0">
          <div className="flex h-full min-h-0 flex-col gap-2">
            <div className="min-h-0 flex-1 overflow-hidden rounded" style={{ border: "1px solid var(--border)" }}>
              {jsonText.length > 50 * 1024 ? (
                <div className="flex h-full items-center justify-center p-4 text-xs" style={{ color: "var(--muted-foreground)" }}>
                  配置过大（&gt;50KB），已拒绝加载编辑器。请拆分或缩小配置后编辑。
                </div>
              ) : (
                <CodeMirror
                  value={jsonText}
                  onChange={setJsonText}
                  extensions={[json(), EditorView.lineWrapping]}
                  theme={theme}
                  height="100%"
                  style={{ fontSize: 12, height: "100%", width: "100%" }}
                />
              )}
            </div>
            <Button variant="default" className="self-start" onClick={saveJson}>
              保存
            </Button>
          </div>
        </TabsContent>
        {kind === "contest" && (
          <TabsContent value="gui" className="h-full min-h-0">
            <div className="flex max-w-md flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label>ren 默认模板（项目）</Label>
                <Select
                  value={renProject || "__unset__"}
                  options={[
                    { value: "__unset__", label: "未设置（跟随全局，默认 noi）" },
                    ...TEMPLATES.map((t) => ({ value: t, label: t })),
                  ]}
                  onChange={(v) => {
                    const t = v === "__unset__" ? "" : v;
                    setRenProjectState(t);
                    setRenProject(dir, t).catch((e) => reportError(`保存项目 ren 模板失败：${e}`));
                  }}
                />
                <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  存于项目根目录 .tuack-gui.json；运行命令面板中显式选择模板运行后也会自动写入。
                </span>
              </div>
            </div>
          </TabsContent>
        )}
      </div>
    </Tabs>
  );
}
