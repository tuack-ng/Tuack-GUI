// Copyright (C) 2025-2026 Tuack-GUI Develop Team.
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 数据点文件内容编辑器（受控）：编辑单个测试点的输入/输出文件内容，由数据工作区传入
// 测试点号与文件名。与「配置 → 测试点」的组织方式编辑区分（一个改结构，一个改内容）。
// 文件不存在时不允许直接编辑，需显式确认「创建此文件」后才进入编辑（保存时落盘创建）。

import { useEffect, useState } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { ArrowLeft, FileQuestion } from "lucide-react";
import { Button } from "../components/ui/button";
import { readTextFile, statPath, writeTextFile } from "../ipc";
import type { AppTheme } from "../theme";

interface Props {
  /** 数据目录绝对路径（如 <dir>/data 或 <dir>/sample） */
  dataDir: string;
  theme: AppTheme;
  /** 测试点号 */
  id: string;
  inFile: string;
  outFile: string;
  onClose: () => void;
}

const MAX_SIZE = 50 * 1024;

export default function DataFileEditor({ dataDir, theme, id, inFile, outFile, onClose }: Props) {
  const [io, setIo] = useState<"input" | "output">("input");
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  const file = io === "input" ? inFile : outFile;
  const path = `${dataDir}/${file}`;

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setMissing(false);
    setStatus("");
    statPath(path)
      .then(({ exists }) => {
        if (!alive) return;
        if (!exists) {
          setMissing(true);
          setLoaded(false);
          return;
        }
        return readTextFile(path).then((c) => {
          if (alive) {
            setContent(c);
            setMissing(false);
            setLoaded(true);
          }
        });
      })
      .catch((e) => {
        if (alive) {
          setMissing(true);
          setStatus(String(e));
        }
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // 用户显式确认创建该文件：进入编辑（内容暂为空，保存时写盘创建）
  function confirmCreate() {
    setMissing(false);
    setContent("");
    setLoaded(true);
    setStatus("新文件，保存时创建");
  }

  async function save() {
    if (!loaded || saving) return;
    setSaving(true);
    setStatus("");
    try {
      await writeTextFile(path, content);
      setStatus("已保存");
    } catch (e) {
      setStatus(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex h-11 shrink-0 flex-wrap items-center gap-2 px-3"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="返回列表">
          <ArrowLeft size={14} />
        </Button>
        <span className="text-xs font-medium" style={{ color: "var(--foreground)" }}>
          数据 #{id}
        </span>
        <div className="flex items-center rounded border" style={{ borderColor: "var(--border)" }}>
          {(
            [
              ["input", "输入"],
              ["output", "输出"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setIo(k)}
              className="px-2 py-1 text-[11px]"
              style={
                io === k
                  ? { backgroundColor: "var(--primary)", color: "#fff" }
                  : { color: "var(--muted-foreground)" }
              }
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          {file}
        </span>
        <span
          className="text-xs"
          style={{ color: status.startsWith("已保存") ? "var(--success)" : "var(--destructive)" }}
        >
          {status}
        </span>
        <div className="ml-auto">
          <Button variant="default" size="sm" onClick={save} disabled={!loaded || saving || missing}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {missing ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
            <FileQuestion size={28} style={{ color: "var(--muted-foreground)" }} />
            <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              文件不存在：{file}
            </div>
            <Button variant="default" size="sm" onClick={confirmCreate}>
              创建此文件
            </Button>
          </div>
        ) : content.length > MAX_SIZE ? (
          <div className="flex h-full items-center justify-center p-4 text-xs" style={{ color: "var(--muted-foreground)" }}>
            文件过大（&gt;50KB），已拒绝加载编辑器。
          </div>
        ) : (
          <CodeMirror
            value={content}
            onChange={setContent}
            extensions={[EditorView.lineWrapping]}
            theme={theme}
            height="100%"
            style={{ fontSize: 13, height: "100%", width: "100%" }}
          />
        )}
      </div>
    </div>
  );
}
