/** DockerOps — Docker CLI 래핑 추상화. `docker` 명령으로 컨테이너 조작. */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import type { Writable, Readable } from "node:stream";

export type ContainerCreateOpts = {
  name: string;
  image: string;
  cmd: string[];
  working_dir?: string;
  env?: Record<string, string>;
  stdin_open?: boolean;
  memory?: string;
  cpus?: number;
  network_mode?: string;
  cap_drop?: string[];
  security_opt?: string[];
  read_only?: boolean;
  tmpfs?: Record<string, string>;
  user?: string;
  pids_limit?: number;
  labels?: Record<string, string>;
  volumes?: string[];
  secrets?: string[];
};

export type ContainerInfo = {
  id: string;
  name: string;
  state: string;
  labels: Record<string, string>;
};

export interface DockerOps {
  create(opts: ContainerCreateOpts): Promise<string>;
  start(id: string): Promise<void>;
  attach(id: string): Promise<{ stdin: Writable; stdout: Readable }>;
  stop(id: string, timeout_s?: number): Promise<void>;
  kill(id: string): Promise<void>;
  rm(id: string): Promise<void>;
  inspect(id: string): Promise<ContainerInfo>;
  list(filters: Record<string, string[]>): Promise<ContainerInfo[]>;
}

export type CliDockerOpsOptions = {
  docker_host?: string;
};

export class CliDockerOps implements DockerOps {
  private readonly host_args: string[];

  constructor(opts?: CliDockerOpsOptions) {
    this.host_args = opts?.docker_host ? ["-H", opts.docker_host] : [];
  }

  async create(opts: ContainerCreateOpts): Promise<string> {
    const args = [...this.host_args, "create"];

    args.push("--name", opts.name);
    if (opts.stdin_open) args.push("-i");
    if (opts.working_dir) args.push("-w", opts.working_dir);
    if (opts.memory) args.push("--memory", opts.memory);
    if (opts.cpus !== undefined) args.push("--cpus", String(opts.cpus));
    if (opts.network_mode) args.push("--network", opts.network_mode);
    if (opts.read_only) args.push("--read-only");
    if (opts.user) args.push("--user", opts.user);
    if (opts.pids_limit !== undefined) args.push("--pids-limit", String(opts.pids_limit));

    if (opts.cap_drop) {
      for (const cap of opts.cap_drop) args.push("--cap-drop", cap);
    }
    if (opts.security_opt) {
      for (const opt of opts.security_opt) args.push("--security-opt", opt);
    }
    if (opts.tmpfs) {
      for (const [path, size] of Object.entries(opts.tmpfs)) {
        args.push("--tmpfs", size ? `${path}:${size}` : path);
      }
    }
    if (opts.labels) {
      for (const [k, v] of Object.entries(opts.labels)) args.push("--label", `${k}=${v}`);
    }
    if (opts.volumes) {
      for (const v of opts.volumes) args.push("-v", v);
    }
    if (opts.env) {
      for (const [k, v] of Object.entries(opts.env)) args.push("-e", `${k}=${v}`);
    }
    if (opts.secrets) {
      for (const s of opts.secrets) args.push("--secret", s);
    }

    args.push(opts.image, ...opts.cmd);

    const stdout = await this.exec(args);
    return stdout.trim();
  }

  async start(id: string): Promise<void> {
    await this.exec([...this.host_args, "start", id]);
  }

  async attach(id: string): Promise<{ stdin: Writable; stdout: Readable }> {
    const proc = spawn("docker", [...this.host_args, "attach", "--no-stdin=false", "--sig-proxy=false", id], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (!proc.stdin || !proc.stdout) {
      throw new Error(`docker attach failed: no stdio for ${id}`);
    }

    return { stdin: proc.stdin, stdout: proc.stdout };
  }

  async stop(id: string, timeout_s?: number): Promise<void> {
    const args = [...this.host_args, "stop"];
    if (timeout_s !== undefined) args.push("-t", String(timeout_s));
    args.push(id);
    await this.exec(args);
  }

  async kill(id: string): Promise<void> {
    await this.exec([...this.host_args, "kill", id]);
  }

  async rm(id: string): Promise<void> {
    await this.exec([...this.host_args, "rm", "-f", id]);
  }

  async inspect(id: string): Promise<ContainerInfo> {
    const stdout = await this.exec([
      ...this.host_args, "inspect",
      "--format", "{{json .}}",
      id,
    ]);
    const raw = JSON.parse(stdout);
    return {
      id: raw.Id ?? id,
      name: (raw.Name ?? "").replace(/^\//, ""),
      state: raw.State?.Status ?? "unknown",
      labels: raw.Config?.Labels ?? {},
    };
  }

  async list(filters: Record<string, string[]>): Promise<ContainerInfo[]> {
    const args = [...this.host_args, "ps", "-a", "--no-trunc", "--format", "{{json .}}"];
    for (const [key, values] of Object.entries(filters)) {
      for (const v of values) args.push("--filter", `${key}=${v}`);
    }
    const stdout = await this.exec(args);
    if (!stdout.trim()) return [];

    return stdout.trim().split("\n").filter(Boolean).map((line) => {
      const raw = JSON.parse(line);
      return {
        id: raw.ID ?? raw.Id ?? "",
        name: (raw.Names ?? raw.Name ?? "").replace(/^\//, ""),
        state: raw.State ?? "unknown",
        labels: parse_label_string(raw.Labels ?? ""),
      };
    });
  }

  private exec(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile("docker", args, { timeout: 30_000 }, (err, stdout, stderr) => {
        if (err) {
          const msg = stderr?.trim() || err.message;
          reject(new Error(`docker ${args[this.host_args.length] ?? ""}: ${msg}`));
          return;
        }
        resolve(stdout);
      });
    });
  }
}

/** `docker ps --format` 의 Labels 문자열을 파싱. "k1=v1,k2=v2" → Record. */
function parse_label_string(labels: string): Record<string, string> {
  if (!labels) return {};
  const result: Record<string, string> = {};
  for (const pair of labels.split(",")) {
    const eq = pair.indexOf("=");
    if (eq > 0) result[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return result;
}
