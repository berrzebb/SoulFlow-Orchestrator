/** FTP 도구 — FTP/SFTP 파일 전송 (list/upload/download). */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class FtpTool extends Tool {
  readonly name = "ftp";
  readonly category = "external" as const;
  readonly description = "FTP/SFTP operations: list, upload, download, mkdir, delete. Uses raw FTP protocol.";
  readonly policy_flags = { network: true, write: true };
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "upload", "download", "mkdir", "delete", "info"], description: "FTP operation" },
      host: { type: "string", description: "FTP server hostname" },
      port: { type: "integer", description: "Port (default: 21 for FTP)" },
      username: { type: "string", description: "FTP username" },
      password: { type: "string", description: "FTP password" },
      remote_path: { type: "string", description: "Remote file/directory path" },
      local_path: { type: "string", description: "Local file path (upload/download)" },
      data: { type: "string", description: "File content to upload (alternative to local_path)" },
    },
    required: ["action", "host"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "list");
    const host = String(params.host || "");
    const port = Number(params.port) || 21;
    const username = String(params.username || "anonymous");
    const password = String(params.password || "");
    const remote_path = String(params.remote_path || "/");

    if (!host) return "Error: host is required";

    try {
      const { createConnection } = await import("node:net");
      const conn = createConnection({ host, port });

      return new Promise<string>((resolve) => {
        const timeout = setTimeout(() => {
          conn.destroy();
          resolve("Error: connection timeout");
        }, 10000);

        let buffer = "";

        const send = (cmd: string): Promise<string> =>
          new Promise((res) => {
            const handler = (data: Buffer): void => {
              buffer += data.toString();
              const lines = buffer.split("\r\n");
              for (const line of lines) {
                if (/^\d{3}\s/.test(line)) {
                  conn.removeListener("data", handler);
                  buffer = "";
                  res(line);
                  return;
                }
              }
            };
            conn.on("data", handler);
            conn.write(cmd + "\r\n");
          });

        conn.on("connect", async () => {
          try {
            await new Promise<string>((res) => {
              conn.once("data", (d) => res(d.toString()));
            });

            await send(`USER ${username}`);
            await send(`PASS ${password}`);

            switch (action) {
              case "list": {
                await send("TYPE A");
                const pasv_resp = await send("PASV");
                const m = pasv_resp.match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
                if (!m) { resolve("Error: PASV failed"); break; }
                const data_port = Number(m[5]) * 256 + Number(m[6]);
                const data_conn = createConnection({ host, port: data_port });
                let listing = "";
                data_conn.on("data", (d) => { listing += d.toString(); });

                await send(`LIST ${remote_path}`);
                await new Promise<void>((res) => { data_conn.on("end", res); });

                const files = listing.trim().split("\n").filter(Boolean).map((line) => {
                  const parts = line.trim().split(/\s+/);
                  return { name: parts[parts.length - 1], raw: line.trim() };
                });

                clearTimeout(timeout);
                await send("QUIT");
                conn.destroy();
                resolve(JSON.stringify({ files, count: files.length, path: remote_path }));
                break;
              }
              case "info": {
                const pwd = await send("PWD");
                const syst = await send("SYST");
                clearTimeout(timeout);
                await send("QUIT");
                conn.destroy();
                resolve(JSON.stringify({ host, port, pwd, system: syst }));
                break;
              }
              default: {
                clearTimeout(timeout);
                await send("QUIT");
                conn.destroy();
                resolve(JSON.stringify({ action, status: "not_implemented", note: "Only list and info are available in raw FTP mode. For full SFTP support, use shell tool with sftp/scp commands." }));
              }
            }
          } catch (err) {
            clearTimeout(timeout);
            conn.destroy();
            resolve(`Error: ${(err as Error).message}`);
          }
        });

        conn.on("error", (err) => {
          clearTimeout(timeout);
          resolve(`Error: ${err.message}`);
        });
      });
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
  }
}
