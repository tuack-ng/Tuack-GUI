// Copyright (C) 2025-2026 Tuack-GUI Develop Team.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button } from "../components/ui/button";
import { Dialog, DialogContent } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

import { useEffect, useState } from "react";
import Select from "./Select";
import { getRenDefaults, setRenProject } from "../ipc";
import { TEMPLATES } from "../templates";
import { reportError } from "../errors";
import type { Command, DumpTarget, RenDefaults } from "../ipc/types";

type FieldKind = "text" | "select" | "object" | "templates";

interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  options?: string[];
  /** 与 options 对齐的显示标签（本地化） */
  labels?: string[];
  placeholder?: string;
  defaultValue?: string;
}

interface CommandSpec {
  id: string;
  label: string;
  /** 功能分类（见 CATEGORIES） */
  cat: string;
  fields: FieldSpec[];
  build: (v: Record<string, string>) => Command;
}

const CATEGORIES = [
  { id: "gen", label: "生成" },
  { id: "test", label: "测试" },
  { id: "ren", label: "渲染" },
  { id: "dump", label: "导出" },
  { id: "doc", label: "文档" },
  { id: "conf", label: "配置" },
];

function splitNames(s: string): string[] {
  return s.trim() ? s.trim().split(/\s+/) : [];
}

const COMMANDS: CommandSpec[] = [
  { id: "gen-data", label: "生成数据（gen data）", cat: "gen", fields: [], build: () => ({ command: "gen", target: "data", names: [], confirm: true }) },
  { id: "gen-samples", label: "生成样例（gen samples）", cat: "gen", fields: [], build: () => ({ command: "gen", target: "samples", names: [], confirm: true }) },
  { id: "gen-all", label: "生成全部（gen all）", cat: "gen", fields: [], build: () => ({ command: "gen", target: "all", names: [], confirm: true }) },
  { id: "test-data", label: "测试正式数据（test data）", cat: "test", fields: [], build: () => ({ command: "test", target: "data" }) },
  { id: "test-sample", label: "测试样例（test sample）", cat: "test", fields: [], build: () => ({ command: "test", target: "sample" }) },
  {
    id: "ren", label: "渲染题面（ren）", cat: "ren",
    fields: [
      { key: "template", label: "模板名", kind: "templates", defaultValue: "__default__" },
      { key: "keep_tmp", label: "保留临时目录", kind: "select", options: ["否", "是"] },
      { key: "no_auto_open", label: "不自动打开", kind: "select", options: ["否", "是"], defaultValue: "是" },
    ],
    build: (v) => ({ command: "ren", template: v.template, keep_tmp: v.keep_tmp === "是", no_auto_open: v.no_auto_open === "是" }),
  },
  {
    id: "dump", label: "导出（dump）", cat: "dump",
    fields: [{ key: "target", label: "目标", kind: "select", options: ["lemon", "arbiter"] }],
    build: (v) => ({ command: "dump", target: v.target as DumpTarget }),
  },
  {
    id: "doc-format", label: "文档格式化（doc format）", cat: "doc",
    fields: [{ key: "explain", label: "解释规则（可选）", kind: "text", placeholder: "留空 = 全部" }],
    build: (v) => ({ command: "doc-format", explain: v.explain.trim() || null }),
  },
  {
    id: "doc-check", label: "文档检查（doc check）", cat: "doc",
    fields: [{ key: "explain", label: "解释规则（可选）", kind: "text", placeholder: "留空 = 全部" }],
    build: (v) => ({ command: "doc-check", explain: v.explain.trim() || null }),
  },
  { id: "doc-validate", label: "文档校验（doc validate）", cat: "doc", fields: [], build: () => ({ command: "doc-validate" }) },
  {
    id: "conf-title", label: "批量设置标题（conf title）", cat: "conf",
    fields: [{ key: "values", label: "标题（按顺序，空格分隔）", kind: "text", placeholder: "标题1 标题2" }],
    build: (v) => ({ command: "conf-title", values: splitNames(v.values) }),
  },
  {
    id: "conf-time", label: "批量设置时限（conf time）", cat: "conf",
    fields: [{ key: "values", label: "时限（按顺序，空格分隔）", kind: "text", placeholder: "1.0 2.0" }],
    build: (v) => ({ command: "conf-time", values: splitNames(v.values) }),
  },
  {
    id: "conf-length", label: "批量设置时长（conf length）", cat: "conf",
    fields: [{ key: "values", label: "时长（按顺序，空格分隔）", kind: "text", placeholder: "4.0 4.5" }],
    build: (v) => ({ command: "conf-length", values: splitNames(v.values) }),
  },
  { id: "conf-migrate", label: "迁移配置（conf migrate）", cat: "conf", fields: [], build: () => ({ command: "conf-migrate" }) },
];

interface Props {
  defaultCwd: string;
  projectRoot: string;
  onRun: (cmd: Command, cwd: string) => void;
  onClose: () => void;
}

export default function CommandPanel({ defaultCwd, projectRoot, onRun, onClose }: Props) {
  const [catId, setCatId] = useState(CATEGORIES[0].id);
  const [cmdId, setCmdId] = useState(COMMANDS[0].id);
  const [cwd, setCwd] = useState(defaultCwd);
  const [values, setValues] = useState<Record<string, string>>({});
  const [renDefaults, setRenDefaults] = useState<RenDefaults>({ global: null, project: null });

  const spec = COMMANDS.find((c) => c.id === cmdId)!;

  useEffect(() => {
    getRenDefaults(projectRoot)
      .then(setRenDefaults)
      .catch((e) => reportError(`读取 ren 默认模板失败：${e}`));
  }, [projectRoot]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const f of spec.fields) {
      next[f.key] = f.defaultValue ?? (f.kind === "select" ? (f.options?.[0] ?? "") : "");
    }
    setValues(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmdId]);

  function setVal(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  const resolvedTemplate = renDefaults.project || renDefaults.global || "noi";

  function submit() {
    const eff = { ...values };
    if (spec.id === "ren") {
      const t = (eff["template"] ?? "").trim();
      if (t && t !== "__default__") {
        // 显式选了模板：记忆为项目默认
        setRenProject(projectRoot, t).catch((e) => reportError(`记忆项目模板失败：${e}`));
      } else {
        eff["template"] = resolvedTemplate;
      }
    }
    onRun(spec.build(eff), cwd.trim());
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[min(640px,80vw)] rounded-lg p-4">
        <div className="mb-3 text-sm" style={{ color: "var(--foreground)" }}>运行命令</div>

        <div className="mb-2 flex gap-2">
          <div className="w-28 shrink-0">
            <Label className="mb-1 block">分组</Label>
            <Select
              value={catId}
              options={CATEGORIES.map((c) => ({ value: c.id, label: c.label }))}
              onChange={(v) => {
                setCatId(v);
                const first = COMMANDS.find((c) => c.cat === v);
                if (first) setCmdId(first.id);
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <Label className="mb-1 block">命令</Label>
            <Select
              value={cmdId}
              options={COMMANDS.filter((c) => c.cat === catId).map((c) => ({
                value: c.id,
                label: c.label,
              }))}
              onChange={setCmdId}
            />
          </div>
        </div>

        {spec.fields.map((f) => (
          <div key={f.key} className="mb-2">
            <Label className="mb-1 block">{f.label}</Label>
            {f.kind === "select" ? (
              <Select
                value={values[f.key] ?? f.options?.[0] ?? ""}
                options={(f.options ?? []).map((o, i) => ({
                  value: o,
                  label: f.labels?.[i] ?? o,
                }))}
                onChange={(v) => setVal(f.key, v)}
              />
            ) : f.kind === "object" ? (
              <div className="flex flex-col gap-1">
                <Select
                  value={values[f.key] === "all" ? "all" : "__custom__"}
                  options={[
                    { value: "all", label: "全部" },
                    { value: "__custom__", label: "自定义范围…" },
                  ]}
                  onChange={(v) => setVal(f.key, v === "all" ? "all" : "")}
                />
                {values[f.key] !== "all" && (
                  <Input
                    type="text"
                    value={values[f.key]}
                    onChange={(e) => setVal(f.key, e.target.value)}
                    placeholder={f.placeholder}
                  />
                )}
              </div>
            ) : f.kind === "templates" ? (
              <Select
                value={values[f.key] || "__default__"}
                options={[
                  { value: "__default__", label: `跟随默认（${resolvedTemplate}）` },
                  ...TEMPLATES.map((t) => ({ value: t, label: t })),
                ]}
                onChange={(v) => setVal(f.key, v)}
              />
            ) : (
              <Input
                type="text"
                value={values[f.key] ?? ""}
                onChange={(e) => setVal(f.key, e.target.value)}
                placeholder={f.placeholder}
              />
            )}
          </div>
        ))}

        <Label className="mb-1 block">工作目录（cwd）</Label>
        <Input
          value={cwd}
          onChange={(e) => setCwd(e.currentTarget.value)}
          className="mb-3"
        />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="default" onClick={submit}>运行</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
