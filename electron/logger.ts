/*
 * C.A.D.S. main-process file logger.
 *
 * Appends to logs/cads-<YYYY-MM-DD>.log (project root in dev, userData when
 * packaged). Tees the main-process console, captures uncaught errors, records
 * the ingest play-by-play, and persists renderer-forwarded errors — so a failed
 * run can be diagnosed after the fact instead of vanishing with the window.
 *
 * Uses synchronous appends: logging is low-volume and must never lose a line to
 * an async race or a crash, and must never itself throw.
 */

import { app } from "electron";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

function logDir(): string {
  const base = app.isPackaged ? app.getPath("userData") : app.getAppPath();
  return path.join(base, "logs");
}

function logFilePath(): string {
  const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (rolls daily)
  return path.join(logDir(), `cads-${stamp}.log`);
}

function format(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function writeLog(level: string, ...parts: unknown[]): void {
  const line = `${new Date().toISOString()} [${level}] ${parts.map(format).join(" ")}\n`;
  try {
    mkdirSync(logDir(), { recursive: true });
    const file = logFilePath();
    // BOM on first write so Windows PowerShell's default Get-Content decodes the
    // UTF-8 file correctly (em-dashes etc.) without needing -Encoding utf8.
    if (!existsSync(file)) appendFileSync(file, "﻿", "utf8");
    appendFileSync(file, line, "utf8");
  } catch {
    /* never let logging crash the app */
  }
}

/** Patch the main-process console, hook uncaught errors, and write a banner. */
export function initLogging(): void {
  const console_ = console as unknown as Record<string, (...args: unknown[]) => void>;
  for (const level of ["log", "info", "warn", "error"] as const) {
    const original = console_[level].bind(console);
    console_[level] = (...args: unknown[]) => {
      writeLog(level === "log" ? "INFO" : level.toUpperCase(), ...args);
      original(...args);
    };
  }

  process.on("uncaughtException", (err) => writeLog("FATAL", err));
  process.on("unhandledRejection", (reason) => writeLog("FATAL", reason));

  writeLog("INFO", `C.A.D.S. session start — logging to ${logFilePath()}`);
}
