// Copyright (C) 2025-2026 Tuack-GUI Develop Team.
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 评测运行器：编排 tuack-ng-rpc 的 run/* 原子能力。
// run/create（异步编译）-> 等 run/ready -> 逐个 run/judge -> run/score。
// 结果缓存供 JudgeView 展示，并持久化到项目级 .tuack-gui.json。

import { loadJudgeResults, loadRenderResults, saveJudgeResult, saveRenderResult } from "../ipc";
import { rpc } from "./client";
import { session, waitUntil } from "./session";
import type { DmkGenResult, JudgeResult, RenFinishedEvent, RunFinishedEvent, ScoreResult, ValidateCheckResult } from "./types";

export type RunTarget = "data" | "sample";

export interface RunResult {
  /** 题目绝对目录 */
  problemDir: string;
  problem: string;
  target: RunTarget;
  /** 被测代码标识（`tests` 的 key，服务端缺省 `std`） */
  tester: string;
  runId: string;
  judged: JudgeResult[];
  score: ScoreResult | null;
  /** 终态事件（cancelled/error），正常完成时为 null */
  finished: RunFinishedEvent | null;
}

/** 最近一次评测结果：`<dir>\0<tester>\0<target>` -> 结果（data/sample 分开缓存） */
const latest = new Map<string, RunResult>();

/** 某题目最近一次评测结果（按 tester 分组）；target 缺省返回全部目标 */
export function getLatestResults(problemDir: string, target?: RunTarget): RunResult[] {
  const prefix = `${problemDir}\u0000`;
  const out: RunResult[] = [];
  for (const [k, v] of latest) {
    if (k.startsWith(prefix) && (!target || v.target === target)) out.push(v);
  }
  return out;
}

/** 从项目级 .tuack-gui.json 恢复评测结果缓存 */
export async function loadPersistedResults(projectRoot: string): Promise<void> {
  try {
    const data = await loadJudgeResults(projectRoot);
    for (const [k, v] of Object.entries(data)) {
      latest.set(k, v as RunResult);
    }
  } catch {
    // 读取失败视为无缓存
  }
}

/** 把单个测试者最新结果写入项目持久化（fire-and-forget） */
function persistJudgeResult(key: string, result: RunResult): void {
  try {
    void saveJudgeResult(session.projectRoot, key, result).catch(() => {});
  } catch {
    // 忽略
  }
}

/** 编译 / 评测输出回调 */
export type JudgeLog = (text: string) => void;

const WAIT_COMPILE = 120_000;

/** 题面预览结果（ren/preview 同步返回模板展开后的 Markdown） */
export interface PreviewResult {
  scope: string;
  template: string;
  markdown: string;
  warnings: string[];
  /** 行映射：source(模板行号) -> rendered(markdown 行号)，用于编辑器与预览同步滚动 */
  lineMap: { source: number; rendered: number }[];
}

/** 最近一次预览结果：scope -> 结果 */
const previews = new Map<string, PreviewResult>();

export function getPreview(scope: string): PreviewResult | undefined {
  return previews.get(scope);
}

/** 调用 ren/preview 获取题面 Markdown 并缓存（同步接口） */
export async function runPreview(scope: string, template: string): Promise<PreviewResult> {
  const res = await rpc.renPreview(session.sid, scope, template);
  const result: PreviewResult = {
    scope,
    template,
    markdown: res.markdown,
    warnings: res.warnings ?? [],
    lineMap: res.lineMap ?? [],
  };
  previews.set(scope, result);
  return result;
}

/** 最近一次 PDF 渲染结果：scope -> 终态（含 tmpDir/files） */
const renders = new Map<string, RenFinishedEvent>();

export function getLatestRender(scope: string): RenFinishedEvent | undefined {
  return renders.get(scope);
}

/** 把渲染结果写入项目持久化（fire-and-forget） */
function persistRender(scope: string, result: RenFinishedEvent): void {
  try {
    void saveRenderResult(session.projectRoot, scope, result).catch(() => {});
  } catch {
    // 忽略
  }
}

/** 从项目级 .tuack-gui.json 恢复某 scope 的最近渲染结果（若存在），供启动/重开后直接加载 */
export async function loadPersistedRender(scope: string): Promise<RenFinishedEvent | undefined> {
  try {
    const all = await loadRenderResults(session.projectRoot);
    const v = all[scope] as RenFinishedEvent | undefined;
    if (v) renders.set(scope, v);
    return v;
  } catch {
    return undefined;
  }
}

/**
 * 对题目/场次跑一次 PDF 渲染（ren/run + 等待 ren/finished）。
 * 产物位于服务端临时目录，结果缓存供 PDF 预览读取。
 */
export async function runRender(
  scope: string,
  template: string,
  onLog?: JudgeLog,
): Promise<RenFinishedEvent> {
  const log = onLog ?? (() => {});
  let taskId: string | null = null;
  let finished: RenFinishedEvent | null = null;

  const off = session.onEvent((method, params) => {
    if (!taskId || params["taskId"] !== taskId) return;
    if (method === "ren/output") {
      const text = params["text"];
      if (typeof text === "string" && text) log(text);
    } else if (method === "ren/progress") {
      const done = params["done"];
      const total = params["total"];
      const item = params["item"];
      log(`渲染进度 ${done}/${total}${item ? `（${item}）` : ""}`);
    } else if (method === "ren/finished") {
      finished = params as unknown as RenFinishedEvent;
    }
  });

  try {
    const created = await rpc.renRun(session.sid, template, scope);
    taskId = created.taskId;
    log(`渲染 ${scope}（模板 ${template}）…`);
    await waitUntil(() => finished !== null, 180_000, "等待渲染完成超时");
    if (finished!.status !== "finished") {
      throw new Error(`渲染失败：${finished!.error ?? finished!.status}`);
    }
    renders.set(scope, finished!);
    persistRender(scope, finished!);
    return finished!;
  } finally {
    off();
  }
}

/** 评测数据点（problem/get 展开后的单点） */
export interface JudgePoint {
  id: string;
  score: number;
  subtask: number;
}

/** 评测进度回调：用于评测视图流式逐点更新 */
export interface JudgeCallbacks {
  onLog?: (text: string) => void;
  onPreparing?: () => void;
  onPoints?: (points: JudgePoint[]) => void;
  onPoint?: (r: JudgeResult) => void;
  onScore?: (s: ScoreResult) => void;
}

/**
 * 对题目跑一次完整评测（正式数据或样例）。
 * `tester` 为被测代码标识（`tests` 的 key），缺省不传由服务端回退 `std`。
 * 事件驱动的编排：先订阅事件再 run/create，避免编译期事件丢失。
 * 通过 callbacks 流式上报进度（编译日志 / 数据点列表 / 单点结果 / 汇总）。
 */
export async function runJudge(
  problemDir: string,
  target: RunTarget,
  tester?: string,
  cb?: JudgeCallbacks,
): Promise<RunResult> {
  const onLog = cb?.onLog ?? (() => {});
  const problem = session.problemId(problemDir);
  let runId: string | null = null;
  let ready = false;
  let finished: RunFinishedEvent | null = null;

  const off = session.onEvent((method, params) => {
    if (!runId || params["runId"] !== runId) return;
    if (method === "run/output") {
      const text = params["text"];
      if (typeof text === "string" && text) onLog(text);
    } else if (method === "run/ready") {
      ready = true;
    } else if (method === "run/finished") {
      finished = params as unknown as RunFinishedEvent;
      ready = true;
    }
  });

  try {
    cb?.onPreparing?.();
    const created = await rpc.runCreate(session.sid, problem, target, tester);
    runId = created.runId;
    await waitUntil(() => ready, WAIT_COMPILE, "等待编译完成超时");
    const fin = finished as unknown as RunFinishedEvent | null;
    if (fin) {
      throw new Error(`评测失败：${fin.error ?? "未知错误"}`);
    }

    const { problem: pd } = await rpc.problemGet(session.sid, problem);
    const points = target === "data" ? pd.data : pd.samples;
    cb?.onPoints?.(
      points.map((p) => ({
        id: String(p.id),
        score: "score" in p ? (p.score ?? 0) : 0,
        subtask: "subtask" in p ? (p.subtask ?? 0) : 0,
      })),
    );

    const judged: JudgeResult[] = [];
    for (const pt of points) {
      const r = await rpc.runJudge(session.sid, runId, String(pt.id));
      judged.push(r);
      cb?.onPoint?.(r);
      const detail = [
        `[${r.testId}] ${r.status}`,
        r.timeMs != null ? `${r.timeMs}ms` : "",
        r.memoryBytes != null ? `${r.memoryBytes} bytes` : "",
        r.message ? r.message : "",
      ]
        .filter(Boolean)
        .join("  ");
      onLog(detail);
    }

    const score = await rpc.runScore(session.sid, runId);
    cb?.onScore?.(score);
    if (score.report) {
      onLog(
        `总分：${score.report.total} / ${score.report.fullScore}（已测 ${score.judged}/${score.total} 点）`,
      );
    }
    const result: RunResult = {
      problemDir,
      problem,
      target,
      tester: tester ?? "std",
      runId,
      judged,
      score,
      finished: null,
    };
    const key = `${problemDir}\u0000${tester ?? "std"}\u0000${target}`;
    latest.set(key, result);
    persistJudgeResult(key, result);
    return result;
  } finally {
    off();
  }
}

// ---- dmk（数据生成）/ validate（输入校验）----

export interface DmkReport {
  problem: string;
  target: "data" | "sample";
  action: "gen" | "regen" | "reset";
  /** testId -> 该点生成结果 */
  results: Record<string, DmkGenResult>;
}

/**
 * 逐点驱动数据生成：dmk/create（异步编译准备）-> 等 dmk/ready -> dmk/get 取 items
 * -> 逐个 dmk/gen（生成输入/输出，写 data/ 或 sample/）。object 为服务端解析的
 * 测试点表达式（"all" 或 "1,2-3"）。
 */
export async function runDmk(
  problem: string,
  target: "data" | "sample",
  action: "gen" | "regen" | "reset",
  validate: boolean | null,
  object: string,
  onLog: JudgeLog,
  onResult?: (r: DmkGenResult) => void,
): Promise<DmkReport> {
  let taskId: string | null = null;
  const state: {
    ready: boolean;
    failed: { state: string; error: string | null } | null;
  } = { ready: false, failed: null };

  const off = session.onEvent((method, params) => {
    if (!taskId || params["taskId"] !== taskId) return;
    if (method === "dmk/ready") {
      state.ready = true;
    } else if (method === "dmk/finished") {
      state.failed = {
        state: params["state"] as string,
        error: (params["error"] as string | null) ?? null,
      };
    }
  });

  try {
    const created = await rpc.dmkCreate(session.sid, problem, target, action, validate, object);
    taskId = created.taskId;
    onLog(`生成 ${problem}（${target}/${action}）…`);
    await waitUntil(() => state.ready || state.failed !== null, 180_000, "等待生成准备超时");
    if (state.failed) {
      throw new Error(state.failed.error ?? `生成失败：${state.failed.state}`);
    }
    const info = await rpc.dmkGet(session.sid, taskId);
    const report: DmkReport = { problem, target, action, results: {} };
    for (const id of info.items) {
      const r = await rpc.dmkGen(session.sid, taskId, String(id));
      report.results[String(id)] = r;
      onResult?.(r);
      const parts = [`[${r.testId}]`];
      parts.push(`输入:${r.input.status}`);
      if (r.input.error) parts.push(r.input.error);
      if (r.output.status === "skip") {
        parts.push(`输出:skip`);
      } else {
        parts.push(`输出:${r.output.status}`);
        if (r.output.error) parts.push(r.output.error);
      }
      onLog(parts.join("  "));
    }
    const ok = Object.values(report.results).filter(
      (r) => r.input.status !== "fail" && r.output.status !== "fail",
    ).length;
    onLog(`生成完成：${ok}/${info.items.length} 个测试点成功`);
    return report;
  } finally {
    off();
  }
}

export interface ValidateReport {
  problem: string;
  target: "data" | "sample";
  /** testId -> 校验结果 */
  results: Record<string, ValidateCheckResult>;
}

/**
 * 只读输入校验：validate/create（编译 Validator）-> 等 validate/ready
 * -> 逐个 validate/check 校验数据点输入文件。
 */
export async function runValidate(
  problem: string,
  target: "data" | "sample",
  onLog: JudgeLog,
): Promise<ValidateReport> {
  let taskId: string | null = null;
  const state: {
    ready: boolean;
    failed: { state: string; error: string | null } | null;
  } = { ready: false, failed: null };

  const off = session.onEvent((method, params) => {
    if (!taskId || params["taskId"] !== taskId) return;
    if (method === "validate/ready") {
      state.ready = true;
    } else if (method === "validate/finished") {
      state.failed = {
        state: params["state"] as string,
        error: (params["error"] as string | null) ?? null,
      };
    }
  });

  try {
    const created = await rpc.validateCreate(session.sid, problem, target);
    taskId = created.taskId;
    onLog(`校验 ${problem}（${target}）…`);
    await waitUntil(() => state.ready || state.failed !== null, 180_000, "等待校验准备超时");
    if (state.failed) {
      throw new Error(state.failed.error ?? `校验失败：${state.failed.state}`);
    }
    // 取数据点列表（dmk 的 items 语义；validate 用 object 过滤已由 create 处理，这里校验全部已存在点）
    const { problem: pd } = await rpc.problemGet(session.sid, problem);
    const points = target === "data" ? pd.data : pd.samples;
    const report: ValidateReport = { problem, target, results: {} };
    for (const pt of points) {
      const r = await rpc.validateCheck(session.sid, taskId, String(pt.id));
      report.results[String(pt.id)] = r;
      onLog(`[${r.testId}] ${r.status}${r.message ? `  ${r.message}` : ""}`);
    }
    const ok = Object.values(report.results).filter((r) => r.status === "ok").length;
    onLog(`校验完成：${ok}/${points.length} 个测试点通过`);
    return report;
  } finally {
    off();
  }
}
