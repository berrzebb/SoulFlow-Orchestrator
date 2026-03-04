#!/usr/bin/env node
/**
 * Bridge MCP Server — 컨테이너 내에서 stdio MCP 프록시로 동작.
 *
 * CLI(Claude/Gemini)가 --mcp-config로 이 스크립트를 MCP 서버로 인식.
 * stdin에서 MCP JSON-RPC 요청 수신 → Unix 소켓으로 전달 → 응답을 stdout으로 반환.
 *
 * 환경변수:
 *   BRIDGE_SOCKET_PATH — 호스트의 ToolBridgeServer Unix 소켓 경로 (바인드 마운트됨).
 *
 * 의존성: Node.js stdlib만 사용 (npm 패키지 없음).
 */

import { createConnection } from "node:net";
import { createInterface } from "node:readline";

const SOCKET_PATH = process.env.BRIDGE_SOCKET_PATH;
if (!SOCKET_PATH) {
  process.stderr.write("bridge-mcp-server: BRIDGE_SOCKET_PATH not set\n");
  process.exit(1);
}

/** JSON-RPC 요청을 소켓으로 전송하고 응답을 기다린다. */
function send_to_bridge(request) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(SOCKET_PATH, () => {
      socket.write(JSON.stringify(request) + "\n");
    });

    const rl = createInterface({ input: socket, crlfDelay: Infinity });

    rl.once("line", (line) => {
      try {
        resolve(JSON.parse(line));
      } catch (e) {
        reject(new Error(`bridge parse error: ${e.message}`));
      } finally {
        socket.destroy();
      }
    });

    socket.on("error", (err) => {
      reject(new Error(`bridge socket error: ${err.message}`));
    });

    // 5분 타임아웃 (MCP 도구 실행 시간 고려)
    socket.setTimeout(300_000, () => {
      socket.destroy();
      reject(new Error("bridge socket timeout"));
    });
  });
}

/** MCP initialize 응답 생성. */
function handle_initialize(id) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "orchestrator-bridge", version: "1.0.0" },
    },
  };
}

/** MCP tools/list → bridge 서버로 전달. */
async function handle_tools_list(id) {
  try {
    const bridge_res = await send_to_bridge({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    if (bridge_res.error) {
      return { jsonrpc: "2.0", id, error: bridge_res.error };
    }
    return { jsonrpc: "2.0", id, result: bridge_res.result };
  } catch (err) {
    return { jsonrpc: "2.0", id, error: { code: -32000, message: err.message } };
  }
}

/** MCP tools/call → bridge 서버로 전달. */
async function handle_tools_call(id, params) {
  try {
    const bridge_res = await send_to_bridge({
      jsonrpc: "2.0", id: 1,
      method: "tools/call",
      params: { name: params?.name, arguments: params?.arguments ?? {} },
    });
    if (bridge_res.error) {
      return {
        jsonrpc: "2.0", id,
        result: {
          content: [{ type: "text", text: `Error: ${bridge_res.error.message}` }],
          isError: true,
        },
      };
    }
    return { jsonrpc: "2.0", id, result: bridge_res.result };
  } catch (err) {
    return {
      jsonrpc: "2.0", id,
      result: {
        content: [{ type: "text", text: `Bridge error: ${err.message}` }],
        isError: true,
      },
    };
  }
}

/** 메인 루프: stdin에서 JSON-RPC 메시지 수신 → 처리 → stdout 응답. */
function main() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let req;
    try {
      req = JSON.parse(trimmed);
    } catch {
      write_response({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      return;
    }

    const { id, method, params } = req;

    // 알림 (id 없음) — MCP notifications/initialized 등
    if (id === undefined || id === null) {
      // 알림은 응답 불필요
      return;
    }

    let response;
    switch (method) {
      case "initialize":
        response = handle_initialize(id);
        break;
      case "tools/list":
        response = await handle_tools_list(id);
        break;
      case "tools/call":
        response = await handle_tools_call(id, params);
        break;
      default:
        response = { jsonrpc: "2.0", id, error: { code: -32601, message: `unsupported method: ${method}` } };
    }

    write_response(response);
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

function write_response(response) {
  process.stdout.write(JSON.stringify(response) + "\n");
}

main();
