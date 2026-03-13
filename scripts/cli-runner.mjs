#!/usr/bin/env node

import { existsSync } from "node:fs";
import { delimiter, extname, isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";

function normalizeExecutablePath(value) {
  if (!value) {
    return null;
  }

  let normalized = String(value).trim();
  let previous = null;
  while (normalized && normalized !== previous) {
    previous = normalized;
    normalized = normalized.trim();
    normalized = normalized.replace(/^['"]+/, "").replace(/['"]+$/, "");
    normalized = normalized.replace(/^\\+"/, "").replace(/\\+"$/, "");
    normalized = normalized.replace(/^\\+/, "").replace(/\\+$/, "");
  }
  return normalized || null;
}

function getWindowsExtensions() {
  const raw = process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD";
  return raw
    .split(";")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function candidatePaths(command) {
  const normalized = normalizeExecutablePath(command);
  if (!normalized) {
    return [];
  }

  const hasPathSeparator = /[\\/]/.test(normalized);
  const directBases = hasPathSeparator || isAbsolute(normalized)
    ? [normalized]
    : (process.env.PATH || "")
        .split(delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => join(entry, normalized));

  if (process.platform !== "win32") {
    return directBases;
  }

  const ext = extname(normalized).toLowerCase();
  const exts = getWindowsExtensions();
  const results = [];

  for (const base of directBases) {
    if (!ext) {
      for (const suffix of exts) {
        results.push(`${base}${suffix}`);
      }
    }
    results.push(base);
  }

  return [...new Set(results)];
}

export function resolveBinary(command, envVarName) {
  const override = envVarName ? normalizeExecutablePath(process.env[envVarName]) : null;

  for (const candidate of override ? candidatePaths(override) : []) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  for (const candidate of candidatePaths(command)) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return override || command;
}

function quoteForCmd(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function spawnResolved(binary, args, options = {}) {
  if (process.platform === "win32") {
    if (/\.(cmd|bat)$/i.test(binary)) {
      const line = [binary, ...args].map(quoteForCmd).join(" ");
      return spawnSync(line, { ...options, shell: true });
    }

    if (/\.ps1$/i.test(binary)) {
      const shell = resolveBinary("pwsh") || resolveBinary("powershell");
      return spawnSync(
        shell,
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", binary, ...args],
        options,
      );
    }
  }

  return spawnSync(binary, args, options);
}
