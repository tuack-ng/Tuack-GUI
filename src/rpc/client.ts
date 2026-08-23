// Copyright (C) 2025-2026 Tuack-GUI Develop Team.
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// tuack-ng-rpc 协议客户端（JSON-RPC 2.0 over stdio，经 Tauri 后端桥接）。
// 协议方法见 tuack-ng 仓库 crates/tuack-ng-rpc/PROTOCOL.md。

import { rpcConnect, rpcRequest, rpcStop } from "../ipc";
import type { RpcEvent } from "../ipc/types";
import type {
  ConfigMigrateResult,
  ConfigResult,
  ConfigSchema,
  ConfigSetResult,
  DmkGenResult,
  DmkGetResult,
  InitializeResult,
  JudgeResult,
  ProblemGetResult,
  ProblemListResult,
  RenGetResult,
  RenPreviewResult,
  RenRunResult,
  RunCreateResult,
  RunGetResult,
  ScoreResult,
  ValidateCheckResult,
  ValidateGetResult,
  WorkspaceListResult,
  WorkspaceOpenResult,
} from "./types";

/** RPC 层错误：携带协议错误码（-32601 / -32001 等） */
export class RpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}

export type EventListener = (method: string, params: Record<string, unknown>) => void;

export class RpcClient {
  private connId: number | null = null;
  private listeners = new Set<EventListener>();

  get connected(): boolean {
    return this.connId !== null;
  }

  /** 建立连接并监听服务端事件，随后完成 initialize 握手（幂等） */
  async connect(): Promise<void> {
    if (this.connId !== null) return;
    const connId = await rpcConnect((e: RpcEvent) => {
      if (e.kind === "event") this.dispatch(e.method, e.params);
    });
    this.connId = connId;
    try {
      // 协议生命周期：initialize 之前任何业务请求都会被服务端拒绝（-32600）
      await rpcRequest(connId, "initialize", {
        clientInfo: { name: "Tuack-GUI", version: "1.0" },
      });
    } catch (e) {
      // 握手失败：断开并抛出，避免留下半初始化连接
      try {
        await rpcStop(connId);
      } catch {
        // 忽略清理失败
      }
      this.connId = null;
      throw e;
    }
  }

  /** 订阅事件，返回取消订阅函数 */
  onEvent(fn: EventListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private dispatch(method: string, params: Record<string, unknown>): void {
    for (const fn of this.listeners) {
      try {
        fn(method, params);
      } catch {
        // 监听器异常不影响其他监听器
      }
    }
  }

  /** 通用调用：发送 JSON-RPC 请求并等待响应 */
  async call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    await this.connect();
    try {
      return (await rpcRequest(this.connId!, method, params)) as T;
    } catch (e) {
      const message = typeof e === "string" ? e : String(e);
      const codeMatch = message.match(/\[RPC (-?\d+)\]/);
      const code = codeMatch ? Number(codeMatch[1]) : -32000;
      throw new RpcError(code, message);
    }
  }

  /** 关闭连接（协议 shutdown 后关 stdin，EOF 等价 exit） */
  async disconnect(): Promise<void> {
    if (this.connId === null) return;
    const id = this.connId;
    this.connId = null;
    try {
      await rpcRequest(id, "shutdown", {});
    } catch {
      // 忽略 shutdown 失败
    }
    try {
      await rpcStop(id);
    } catch {
      // 忽略
    }
    this.listeners.clear();
  }

  // ---- 生命周期 ----

  initialize(clientInfo?: { name: string; version: string }): Promise<InitializeResult> {
    return this.call<InitializeResult>("initialize", {
      clientInfo: clientInfo ?? { name: "Tuack-GUI", version: "1.0" },
    });
  }

  shutdown(): Promise<null> {
    return this.call<null>("shutdown");
  }

  // ---- workspace ----

  workspaceOpen(uri: string): Promise<WorkspaceOpenResult> {
    return this.call<WorkspaceOpenResult>("workspace/open", { uri });
  }

  workspaceClose(sessionId: string): Promise<null> {
    return this.call<null>("workspace/close", { sessionId });
  }

  workspaceList(): Promise<WorkspaceListResult> {
    return this.call<WorkspaceListResult>("workspace/list");
  }

  // ---- config ----

  configSchema(): Promise<ConfigSchema> {
    return this.call<ConfigSchema>("config/schema");
  }

  configGet(sessionId: string, scope?: string): Promise<ConfigResult> {
    return this.call<ConfigResult>("config/get", { sessionId, scope });
  }

  configSet(
    sessionId: string,
    scope: string,
    field: string,
    value: unknown,
    revision?: number,
  ): Promise<ConfigSetResult> {
    const params: Record<string, unknown> = { sessionId, scope, field, value };
    if (revision !== undefined) params.revision = revision;
    return this.call<ConfigSetResult>("config/set", params);
  }

  configReload(sessionId: string, scope?: string): Promise<ConfigResult> {
    return this.call<ConfigResult>("config/reload", { sessionId, scope });
  }

  configMigrate(sessionId: string): Promise<ConfigMigrateResult> {
    return this.call<ConfigMigrateResult>("config/migrate", { sessionId });
  }

  // ---- problem ----

  problemList(sessionId: string, scope?: string): Promise<ProblemListResult> {
    return this.call<ProblemListResult>("problem/list", { sessionId, scope });
  }

  problemGet(sessionId: string, problem: string): Promise<ProblemGetResult> {
    return this.call<ProblemGetResult>("problem/get", { sessionId, problem });
  }

  // ---- run ----

  runCreate(
    sessionId: string,
    problem: string,
    target: "data" | "sample",
    tester?: string,
  ): Promise<RunCreateResult> {
    const params: Record<string, unknown> = { sessionId, problem, target };
    if (tester) params.tester = tester;
    return this.call<RunCreateResult>("run/create", params);
  }

  runJudge(sessionId: string, runId: string, testId: string): Promise<JudgeResult> {
    return this.call<JudgeResult>("run/judge", { sessionId, runId, testId });
  }

  runScore(sessionId: string, runId: string): Promise<ScoreResult> {
    return this.call<ScoreResult>("run/score", { sessionId, runId });
  }

  runCancel(sessionId: string, runId: string): Promise<null> {
    return this.call<null>("run/cancel", { sessionId, runId });
  }

  runGet(sessionId: string, runId: string): Promise<RunGetResult> {
    return this.call<RunGetResult>("run/get", { sessionId, runId });
  }

  // ---- ren ----

  renPreview(sessionId: string, scope: string, template?: string): Promise<RenPreviewResult> {
    return this.call<RenPreviewResult>("ren/preview", { sessionId, scope, template });
  }

  renRun(sessionId: string, template: string, scope?: string): Promise<RenRunResult> {
    return this.call<RenRunResult>("ren/run", { sessionId, template, scope });
  }

  renCancel(sessionId: string, taskId: string): Promise<null> {
    return this.call<null>("ren/cancel", { sessionId, taskId });
  }

  renGet(sessionId: string, taskId: string): Promise<RenGetResult> {
    return this.call<RenGetResult>("ren/get", { sessionId, taskId });
  }

  // ---- dmk ----

  dmkCreate(
    sessionId: string,
    problem: string,
    target: "data" | "sample",
    action: "gen" | "regen" | "reset",
    validate?: boolean | null,
    object?: string,
  ): Promise<{ taskId: string }> {
    const params: Record<string, unknown> = { sessionId, problem, target, action };
    if (validate !== undefined && validate !== null) params.validate = validate;
    if (object && object !== "all") params.object = object;
    return this.call<{ taskId: string }>("dmk/create", params);
  }

  dmkGen(sessionId: string, taskId: string, testId: string): Promise<DmkGenResult> {
    return this.call<DmkGenResult>("dmk/gen", { sessionId, taskId, testId });
  }

  dmkGet(sessionId: string, taskId: string): Promise<DmkGetResult> {
    return this.call<DmkGetResult>("dmk/get", { sessionId, taskId });
  }

  dmkCancel(sessionId: string, taskId: string): Promise<null> {
    return this.call<null>("dmk/cancel", { sessionId, taskId });
  }

  // ---- validate ----

  validateCreate(sessionId: string, problem: string, target: "data" | "sample"): Promise<{ taskId: string }> {
    return this.call<{ taskId: string }>("validate/create", { sessionId, problem, target });
  }

  validateCheck(sessionId: string, taskId: string, testId: string): Promise<ValidateCheckResult> {
    return this.call<ValidateCheckResult>("validate/check", { sessionId, taskId, testId });
  }

  validateGet(sessionId: string, taskId: string): Promise<ValidateGetResult> {
    return this.call<ValidateGetResult>("validate/get", { sessionId, taskId });
  }

  validateCancel(sessionId: string, taskId: string): Promise<null> {
    return this.call<null>("validate/cancel", { sessionId, taskId });
  }
}

/** 默认单例：整个应用共享一条 tuack-ng-rpc 连接 */
export const rpc = new RpcClient();
