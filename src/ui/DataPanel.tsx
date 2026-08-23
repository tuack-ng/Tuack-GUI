// Copyright (C) 2025-2026 Tuack-GUI Develop Team.
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 数据工作区：把 内容编辑 / 生成（dmk）/ 校验（validate）统一为对数据点的操作，
// 摒弃 CLI 命令式的独立页面。围绕数据点列表组织：显示生成/校验状态，选中后按上下文操作。
//
// 数据点权威列表来自 problem/get（bundle 已展开）；文件名取自 conf.json 的 data（缺省 <id>.in/.ans）；
// 「已生成」由 data/<file> 是否存在判定；校验状态为本次会话内 validate 的结果。

import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, Play, ShieldCheck, FileEdit } from "lucide-react";
import Select from "./Select";
import { statPath } from "../ipc";
import DataFileEditor from "./DataFileEditor";
import { session } from "../rpc/session";
import { runDmk, runValidate } from "../rpc/runner";
import { rpc } from "../rpc/client";
import type { ValidateCheckResult, ValidateStatus } from "../rpc/types";
import type { AppTheme } from "../theme";

interface Props {
  dir: string;
  theme: AppTheme;
  onProjectRefresh?: () => void;
}

interface Dp {
  id: string;
  inFile: string;
  outFile: string;
  inExists: boolean;
  outExists: boolean;
}

type ValidationMap = Record<string, ValidateStatus>;

/** 从 conf.json 的 data 提取 filename 映射：id -> { input, output } */
function fileNameMap(data: unknown): Record<string, { input: string; output: string }> {
  const map: Record<string, { input: string; output: string }> = {};
  if (Array.isArray(data)) {
    for (const item of data as Array<Record<string, unknown>>) {
      const ids = Array.isArray(item.id) ? (item.id as unknown[]).map(Number) : [Number(item.id ?? 0)];
      const input = typeof item.input === "string" ? item.input : null;
      const output = typeof item.output === "string" ? item.output : null;
      for (const id of ids) {
        // bundle 内部点没有独立的 input/output 字段，用缺省 <id>.in/.ans
        map[String(id)] = {
          input: input ?? `${id}.in`,
          output: output ?? `${id}.ans`,
        };
      }
    }
  }
  return map;
}

function objectExpr(ids: string[]): string {
  // 把选中的 id 列表转成 dmk 的 object 表达式（"1,2-3"）
  const nums = ids.map(Number).sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = nums[0];
  let prev = nums[0];
  for (let i = 1; i <= nums.length; i++) {
    if (nums[i] === prev + 1) {
      prev = nums[i];
    } else {
      ranges.push(start === prev ? String(start) : `${start}-${prev}`);
      start = nums[i];
      prev = nums[i];
    }
  }
  return ranges.length > 0 ? ranges.join(",") : "all";
}

export default function DataPanel({ dir, theme, onProjectRefresh }: Props) {
  const [setName, setSetName] = useState<"data" | "sample">("data");
  const [points, setPoints] = useState<Dp[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [validation, setValidation] = useState<ValidationMap>({});
  const [validatedAll, setValidatedAll] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string } | null>(null);
  const [status, setStatus] = useState("");
  /** 生成操作类型：生成缺失 / 同种子重生成 / 重置种子重生成 */
  const [action, setAction] = useState<"gen" | "regen" | "reset">("gen");

  const problemId = useMemo(() => (dir ? session.problemId(dir) : ""), [dir]);

  // 加载数据点列表 + 文件名 + 文件存在状态
  const load = useCallback(async () => {
    const problem = problemId || (dir ? session.problemId(dir) : "");
    if (!problem) return;
    const p = (await rpc.problemGet(session.sid, problem)).problem;
    const isData = setName === "data";
    const targets = isData ? p.data : p.samples;
    const filename = fileNameMap((await session.getConfig(dir).catch(() => null))?.config["data"]);
    const sub = isData ? "data" : "sample";
    const list: Dp[] = [];
    for (const t of targets) {
      const id = String(t.id);
      const s = t as { input?: string; output?: string };
      const f = filename[id] ?? {};
      const inFile = (isData ? f.input : s.input) ?? `${t.id}.in`;
      const outFile = (isData ? f.output : s.output) ?? `${t.id}.ans`;
      const [inEx, outEx] = await Promise.all([
        statPath(`${dir}/${sub}/${inFile}`),
        statPath(`${dir}/${sub}/${outFile}`),
      ]);
      list.push({
        id,
        inFile,
        outFile,
        inExists: inEx.exists,
        outExists: outEx.exists,
      });
    }
    setPoints(list);
    setSelected(new Set());
    setValidation({});
    setValidatedAll(false);
  }, [dir, problemId, setName]);

  useEffect(() => {
    setPoints(null);
    load().catch((e) => setStatus(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, setName]);

  const selIds = useMemo(() => [...selected], [selected]);
  const allIds = useMemo(() => (points ?? []).map((p) => p.id), [points]);

  async function generate(ids: string[]) {
    if (running) return;
    setRunning("gen");
    setStatus("");
    try {
      const report = await runDmk(problemId, setName, action, null, objectExpr(ids.length ? ids : allIds), () => {});
      setStatus(`生成完成：${Object.values(report.results).length} 个测试点`);
      onProjectRefresh?.();
      await load();
    } catch (e) {
      setStatus(String(e));
    } finally {
      setRunning(null);
    }
  }

  async function validate(ids: string[]) {
    if (running) return;
    setRunning("validate");
    setStatus("");
    try {
      const report = await runValidate(problemId, setName, () => {});
      const map: ValidationMap = {};
      for (const [k, r] of Object.entries(report.results)) map[k] = (r as ValidateCheckResult).status;
      setValidation(map);
      setValidatedAll(ids.length === 0 || ids.length === allIds.length);
      const ok = Object.values(report.results).filter((r) => r.status === "ok").length;
      setStatus(`校验完成：${ok}/${Object.keys(report.results).length} 个测试点通过`);
    } catch (e) {
      setStatus(String(e));
    } finally {
      setRunning(null);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 全选 / 全不选
  function toggleAll() {
    if (allIds.length === 0) return;
    setSelected(selIds.length === allIds.length ? new Set() : new Set(allIds));
  }

  const target = selIds.length > 0 ? selIds : allIds;
  const genLabel = selIds.length > 0 ? "生成选定" : "生成全部";
  const valLabel = selIds.length > 0 ? "校验选定" : "校验全部";

  if (editing && points) {
    const p = points.find((x) => x.id === editing.id);
    if (!p) {
      setEditing(null);
      return null;
    }
    const dataDir = `${dir}/${setName === "data" ? "data" : "sample"}`;
    return (
      <DataFileEditor
        dataDir={dataDir}
        theme={theme}
        id={p.id}
        inFile={p.inFile}
        outFile={p.outFile}
        onClose={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex h-11 shrink-0 flex-wrap items-center gap-2 px-3"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <span style={{ color: "var(--foreground)" }}>
          <Database size={16} />
        </span>
        <div className="flex items-center rounded border" style={{ borderColor: "var(--border)" }}>
          {(["data", "sample"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setSetName(k)}
              className="px-2 py-1 text-[11px]"
              style={setName === k ? { backgroundColor: "var(--primary)", color: "#fff" } : { color: "var(--muted-foreground)" }}
            >
              {k === "data" ? "正式数据" : "样例"}
            </button>
          ))}
        </div>
        {status ? (
          <span className="text-xs" style={{ color: status.startsWith("失败") || status.startsWith("校验失败") || status.startsWith("生成失败") ? "var(--destructive)" : "var(--muted-foreground)" }}>
            {status}
          </span>
        ) : (
          <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            {points ? `${points.length} 个数据点` : "加载中…"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="w-24">
            <Select
              value={action}
              options={[
                { value: "gen", label: "生成缺失" },
                { value: "regen", label: "重新生成" },
                { value: "reset", label: "重置生成" },
              ]}
              onChange={(v) => setAction(v as "gen" | "regen" | "reset")}
            />
          </div>
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50"
            style={{ color: "var(--muted-foreground)" }}
            onClick={() => generate(target)}
            disabled={!!running || !points}
          >
            {running === "gen" ? <span className="flex items-center gap-1"><Play size={12} />生成中…</span> : <><Play size={12} />{genLabel}</>}
          </button>
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50"
            style={{ color: "var(--muted-foreground)" }}
            onClick={() => validate(target)}
            disabled={!!running || !points}
          >
            {running === "validate" ? <span className="flex items-center gap-1"><ShieldCheck size={12} />校验中…</span> : <><ShieldCheck size={12} />{valLabel}</>}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {!points ? (
          <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>加载中…</div>
        ) : points.length === 0 ? (
          <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            无数据点，先在「配置 → 测试点」组织数据点结构
          </div>
        ) : (
          <>
            <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th className="w-8 p-1 text-center">
                    <input
                      type="checkbox"
                      readOnly
                      checked={selIds.length > 0 && selIds.length === allIds.length}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleAll();
                      }}
                    />
                  </th>
                  {["#", "输入", "输出", "校验"].map((h) => (
                    <th key={h} className="p-1 text-left" style={{ color: "var(--muted-foreground)" }}>
                      {h}
                    </th>
                  ))}
                  <th className="p-1"></th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => {
                  const v = validation[p.id];
                  return (
                    <tr
                      key={p.id}
                      className="cursor-pointer"
                      style={{ borderBottom: "1px solid var(--border)", backgroundColor: selected.has(p.id) ? "var(--accent)" : undefined }}
                      onClick={() => toggle(p.id)}
                    >
                      <td className="p-1 text-center">
                        <input type="checkbox" readOnly checked={selected.has(p.id)} />
                      </td>
                      <td className="p-1">#{p.id}</td>
                      <td className="p-1" style={{ color: p.inExists ? "var(--muted-foreground)" : "var(--destructive)" }}>
                        {p.inFile}
                      </td>
                      <td className="p-1" style={{ color: p.outExists ? "var(--muted-foreground)" : "var(--destructive)" }}>
                        {p.outFile}
                      </td>
                      <td className="p-1" style={{ color: v === "ok" ? "var(--success)" : v === "fail" ? "var(--destructive)" : "var(--muted-foreground)" }}>
                        {validatedAll ? (v === "ok" ? "✓ 通过" : v === "fail" ? "✕ 失败" : "—") : v === "ok" ? "✓ 通过" : v === "fail" ? "✕ 失败" : "— 未校验"}
                      </td>
                      <td className="p-1 text-right">
                        <button
                          className="rounded px-1.5 py-0.5 text-[11px]"
                          style={{ color: "var(--primary)" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing({ id: p.id });
                          }}
                        >
                          <FileEdit size={12} className="mr-0.5 inline" />
                          编辑
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
