/** DockerPty — Docker 컨테이너로 Pty 인터페이스 구현. */

import type { Writable, Readable } from "node:stream";
import type { Pty, PtySpawnOptions, PtyFactory, Disposable } from "./types.js";
import type { DockerOps, ContainerCreateOpts } from "./docker-ops.js";
import {
  BRIDGE_SOCKET_CONTAINER_DIR,
  BRIDGE_SCRIPT_CONTAINER_PATH,
  BRIDGE_MCP_CONFIG_CONTAINER_PATH,
} from "./tool-bridge-config.js";
import { swallow } from "../../utils/common.js";

export type ContainerSecurityOptions = {
  memory?: string;
  cpus?: number;
  network_mode?: string;
  cap_drop?: string[];
  security_opt?: string[];
  read_only?: boolean;
  tmpfs?: Record<string, string>;
  user?: string;
  pids_limit?: number;
};

export type DockerPtyOptions = {
  docker: DockerOps;
  image: string;
  security?: ContainerSecurityOptions;
  /** 컨테이너에 마운트할 볼륨. ["host:container:ro"] */
  volumes?: string[];
  /** Tool Bridge 설정. 주입 시 자동으로 소켓/스크립트/설정 볼륨 마운트. */
  bridge?: {
    socket_dir: string;
    script_path: string;
    mcp_config_path: string;
  };
};

const DEFAULT_SECURITY: ContainerSecurityOptions = {
  memory: "512m",
  cpus: 1.0,
  network_mode: "none",
  cap_drop: ["ALL"],
  security_opt: ["no-new-privileges"],
  read_only: true,
  tmpfs: { "/tmp": "size=100m" },
  user: "1000:1000",
  pids_limit: 100,
};

export class DockerPty implements Pty {
  readonly pid: string;
  private readonly docker: DockerOps;
  private stdin: Writable | null = null;
  private readonly data_listeners = new Set<(data: string) => void>();
  private readonly exit_listeners = new Set<(e: { exitCode: number }) => void>();
  private exited = false;
  private readonly write_buffer: string[] = [];
  private ready = false;

  constructor(
    docker: DockerOps,
    file: string,
    args: string[],
    spawn_options: PtySpawnOptions,
    opts: DockerPtyOptions,
  ) {
    this.docker = docker;
    this.pid = `docker-${spawn_options.name}`;

    // 비동기 초기화 시작. PtyFactory는 sync이므로 fire-and-forget.
    void this.init(file, args, spawn_options, opts);
  }

  private async init(
    file: string,
    args: string[],
    spawn_options: PtySpawnOptions,
    opts: DockerPtyOptions,
  ): Promise<void> {
    try {
      const sec = { ...DEFAULT_SECURITY, ...opts.security };

      const create_opts: ContainerCreateOpts = {
        name: spawn_options.name,
        image: opts.image,
        cmd: [file, ...args],
        working_dir: spawn_options.cwd,
        env: spawn_options.env,
        stdin_open: true,
        memory: sec.memory,
        cpus: sec.cpus,
        network_mode: sec.network_mode,
        cap_drop: sec.cap_drop,
        security_opt: sec.security_opt,
        read_only: sec.read_only,
        tmpfs: sec.tmpfs,
        user: sec.user,
        pids_limit: sec.pids_limit,
        labels: {
          "sf.session_key": spawn_options.name,
          "sf.cli": file,
        },
        volumes: this.build_volumes(opts),
      };

      const container_id = await this.docker.create(create_opts);
      // kill()이 create 대기 중 먼저 호출된 경우 생성된 컨테이너를 즉시 정리
      if (this.exited) {
        swallow(this.docker.rm(container_id));
        return;
      }
      // pid를 실제 container ID로 갱신
      (this as { pid: string }).pid = container_id;

      await this.docker.start(container_id);
      // start 대기 중 kill()이 호출된 경우 컨테이너 정리
      if (this.exited) {
        swallow(this.docker.stop(container_id, 0));
        swallow(this.docker.rm(container_id));
        return;
      }
      const { stdin, stdout } = await this.docker.attach(container_id);

      this.stdin = stdin;
      this.wire_stdout(stdout);
      this.ready = true;

      // 버퍼에 쌓인 데이터 flush
      for (const data of this.write_buffer) {
        stdin.write(data);
      }
      this.write_buffer.length = 0;
    } catch (_err) {
      this.emit_exit(1);
    }
  }

  write(data: string): void {
    if (this.exited) return;
    if (!this.ready) {
      this.write_buffer.push(data);
      return;
    }
    this.stdin?.write(data);
  }

  end(data?: string): void {
    if (this.exited) return;
    if (!this.ready) {
      if (data) this.write_buffer.push(data);
      // init 완료 후 end 처리를 위해 센티널 추가
      this.write_buffer.push("\x04"); // EOT
      return;
    }
    if (data) this.stdin?.write(data);
    this.stdin?.end();
  }

  onData(cb: (data: string) => void): Disposable {
    this.data_listeners.add(cb);
    return { dispose: () => { this.data_listeners.delete(cb); } };
  }

  onExit(cb: (e: { exitCode: number }) => void): Disposable {
    if (this.exited) {
      cb({ exitCode: 1 });
      return { dispose: () => {} };
    }
    this.exit_listeners.add(cb);
    return { dispose: () => { this.exit_listeners.delete(cb); } };
  }

  kill(): void {
    if (this.exited) return;
    this.exited = true;
    // 비동기 정리. fire-and-forget — kill + rm.
    swallow(this.docker.kill(this.pid));
    swallow(this.docker.rm(this.pid));
    this.emit_exit(137); // SIGKILL
  }

  resize(): void {
    // headless CLI — no-op
  }

  /** 기본 볼륨 + bridge 볼륨 조립. */
  private build_volumes(opts: DockerPtyOptions): string[] | undefined {
    const vols = [...(opts.volumes ?? [])];
    if (opts.bridge) {
      vols.push(`${opts.bridge.socket_dir}:${BRIDGE_SOCKET_CONTAINER_DIR}`);
      vols.push(`${opts.bridge.script_path}:${BRIDGE_SCRIPT_CONTAINER_PATH}:ro`);
      vols.push(`${opts.bridge.mcp_config_path}:${BRIDGE_MCP_CONFIG_CONTAINER_PATH}:ro`);
    }
    return vols.length > 0 ? vols : undefined;
  }

  private wire_stdout(stdout: Readable): void {
    stdout.setEncoding("utf8");
    stdout.on("data", (chunk: string) => {
      for (const cb of this.data_listeners) cb(chunk);
    });
    stdout.on("close", () => {
      if (!this.exited) this.emit_exit(0);
    });
    stdout.on("error", () => {
      if (!this.exited) this.emit_exit(1);
    });
  }

  private emit_exit(exitCode: number): void {
    this.exited = true;
    for (const cb of this.exit_listeners) cb({ exitCode });
  }
}

/** DockerOps 기반 PtyFactory 생성. */
export function create_docker_pty_factory(opts: DockerPtyOptions): PtyFactory {
  return (file, args, spawn_options) =>
    new DockerPty(opts.docker, file, args, spawn_options, opts);
}
