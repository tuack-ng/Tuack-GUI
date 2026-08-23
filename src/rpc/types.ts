// Copyright (C) 2025-2026 Tuack-GUI Develop Team.
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// tuack-ng-rpc 协议领域类型（见 tuack-ng 仓库 crates/tuack-ng-rpc/PROTOCOL.md）。

// ---- 基础类型 ----

export type Scope = "contest" | string; // "contest" | "<day>" | "<day>/<problem>"
export type ProblemType = "program" | "output" | "interactive";
export type TestStatus = "AC" | "WA" | "RE" | "TLE" | "MLE" | "UKE" | "FE" | "PC";
export type RunState = "preparing" | "ready" | "cancelled" | "error" | "closed";
export type RenState = "running" | "finished" | "cancelled" | "error";
export type Channel = "stdout" | "stderr" | "compiler" | "judge" | "renderer" | "system";

export interface ServerInfo {
  name: string;
  version: string;
}

// ---- 生命周期 ----

export interface InitializeResult {
  protocolVersion: string;
  serverInfo: ServerInfo;
  capabilities: string[];
}

// ---- workspace ----

export interface SessionSummary {
  sessionId: string;
  uri: string;
}

export interface ContestSummary {
  name: string;
  days: string[];
  uri: string;
}

export interface WorkspaceOpenResult {
  sessionId: string;
  workspace: { uri: string };
  contest: ContestSummary | null;
}

export interface WorkspaceListResult {
  sessions: SessionSummary[];
}

// ---- config ----

export interface ConfigResult {
  revision: number;
  config: Record<string, unknown>;
  path: string;
  uri: string;
}

export interface ConfigSchema {
  contest: unknown;
  day: unknown;
  problem: unknown;
}

export interface ConfigSetResult {
  revision: number;
  config: Record<string, unknown>;
}

export interface ConfigMigrateResult {
  migrated: boolean;
  notices: string[];
}

// ---- problem ----

export interface ProblemDataPoint {
  id: number;
  score: number;
  subtask: number;
}

export interface ProblemSample {
  id: number;
  input?: string;
  output?: string;
}

export interface ProblemDescriptor {
  name: string;
  title: string;
  problemType: ProblemType;
  timeLimitMs: number;
  memoryLimitBytes: number;
  fileIo: { input: string; output: string } | null;
  data: ProblemDataPoint[];
  samples: ProblemSample[];
  checker: unknown;
  validator: unknown;
  path: string;
}

export interface ProblemListResult {
  problems: ProblemDescriptor[];
}

export interface ProblemGetResult {
  problem: ProblemDescriptor;
}

// ---- run ----

export interface JudgeResult {
  testId: string;
  status: TestStatus;
  timeMs: number | null;
  memoryBytes: number | null;
  message: string | null;
  score: number;
  fullScore: number;
}

export interface RunCreateResult {
  runId: string;
}

export interface ScoreReport {
  groups: { id: number; earned: number; full: number }[];
  total: number;
  fullScore: number;
}

export interface ScoreResult {
  judged: number;
  total: number;
  report: ScoreReport;
}

export interface RunJudgedPoint {
  testId: string;
  status: TestStatus;
  timeMs: number | null;
  memoryBytes: number | null;
  message: string | null;
  score: number;
  fullScore: number;
}

export interface RunGetResult {
  state: RunState;
  problem: string;
  target: string;
  tester: string;
  judged: RunJudgedPoint[];
  report: ScoreReport | null;
  error: string | null;
}

// ---- ren ----

export interface RenPreviewResult {
  markdown: string;
  warnings: string[];
  /** 渲染前后行映射：source = 模板（statement.md）行号，rendered = 渲染后 markdown 行号 */
  lineMap?: { source: number; rendered: number }[];
}

export interface RenRunResult {
  taskId: string;
}

export interface RenFile {
  path: string;
}

export interface RenGetResult {
  state: RenState;
  template: string;
  progress: { done: number; total: number };
  tmpDir: string | null;
  files: RenFile[];
  warnings: string[];
  error: string | null;
}

// ---- 事件（Notification 的 params）----

export interface RunStartedEvent {
  seq: number;
  sessionId: string;
  runId: string;
  problem: string;
  target: string;
  tester: string;
}

export interface RunOutputEvent {
  seq: number;
  sessionId: string;
  runId: string;
  testId: string | null;
  channel: Channel;
  text: string;
}

export interface RunReadyEvent {
  seq: number;
  sessionId: string;
  runId: string;
}

export interface RunFinishedEvent {
  seq: number;
  sessionId: string;
  runId: string;
  state: RunState;
  error: string | null;
}

export interface RenStartedEvent {
  seq: number;
  sessionId: string;
  taskId: string;
  template: string;
  scope: string;
}

export interface RenOutputEvent {
  seq: number;
  sessionId: string;
  taskId: string;
  channel: Channel;
  text: string;
}

export interface RenProgressEvent {
  seq: number;
  sessionId: string;
  taskId: string;
  done: number;
  total: number;
  item: string;
}

export interface RenFinishedEvent {
  seq: number;
  sessionId: string;
  taskId: string;
  status: RenState;
  tmpDir: string | null;
  files: RenFile[];
  warnings: string[];
  error: string | null;
}

// ---- dmk（数据生成）----

export type DmkAction = "gen" | "regen" | "reset";
export type DmkState = "preparing" | "ready" | "cancelled" | "error";
export type DmkStatus = "gen" | "regen" | "reset" | "skip" | "empty" | "fail";

export interface DmkPointResult {
  status: DmkStatus;
  error: string | null;
}

export interface DmkCreateResult {
  taskId: string;
}

export interface DmkGenResult {
  testId: string;
  input: DmkPointResult;
  output: DmkPointResult;
}

export interface DmkGetResult {
  state: DmkState;
  problem: string;
  target: string;
  action: DmkAction;
  items: number[];
  targetDir: string;
  seeds: Record<string, number>;
  /** testId -> { testId, input, output } */
  results: Record<string, DmkGenResult>;
  error: string | null;
}

export interface DmkStartedEvent {
  seq: number;
  sessionId: string;
  taskId: string;
  problem: string;
  target: string;
  action: string;
}

export interface DmkReadyEvent {
  seq: number;
  sessionId: string;
  taskId: string;
}

export interface DmkFinishedEvent {
  seq: number;
  sessionId: string;
  taskId: string;
  state: DmkState;
  error: string | null;
}

// ---- validate（输入校验）----

export type ValidateStatus = "ok" | "fail";

export interface ValidateCreateResult {
  taskId: string;
}

export interface ValidateCheckResult {
  testId: string;
  status: ValidateStatus;
  message: string | null;
}

export interface ValidateGetResult {
  state: DmkState;
  problem: string;
  target: string;
  /** testId -> { testId, status, message } */
  results: Record<string, ValidateCheckResult>;
  error: string | null;
}

export interface ValidateStartedEvent {
  seq: number;
  sessionId: string;
  taskId: string;
  problem: string;
  target: string;
}

export interface ValidateReadyEvent {
  seq: number;
  sessionId: string;
  taskId: string;
}

export interface ValidateFinishedEvent {
  seq: number;
  sessionId: string;
  taskId: string;
  state: DmkState;
  error: string | null;
}
