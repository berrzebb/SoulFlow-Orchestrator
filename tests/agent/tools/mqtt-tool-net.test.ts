/**
 * MqttTool — publish/subscribe/info 테스트 (vi.mock으로 node:net 대체).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock 상태 ─────────────────────────────────────────

const { mqtt_state } = vi.hoisted(() => {
  const state = {
    emit_error: false,
    error_msg: "ECONNREFUSED",
    // 연결 ACK 발행 여부 (CONNACK 패킷)
    send_connack: true,
    // subscribe 테스트용: 메시지 도착 여부
    send_publish: false,
    publish_topic: "test",
    publish_payload: "hello",
  };
  return { mqtt_state: state };
});

// CONNACK 패킷 (0x20 0x02 0x00 0x00)
const CONNACK = Buffer.from([0x20, 0x02, 0x00, 0x00]);

// PUBLISH 패킷 빌더
function make_publish_packet(topic: string, payload: string): Buffer {
  const t_buf = Buffer.from(topic, "utf-8");
  const p_buf = Buffer.from(payload, "utf-8");
  const t_len = Buffer.alloc(2);
  t_len.writeUInt16BE(t_buf.length);
  const remaining = 2 + t_buf.length + p_buf.length;
  return Buffer.concat([
    Buffer.from([0x30, remaining]),
    t_len, t_buf, p_buf,
  ]);
}

vi.mock("node:net", () => ({
  createConnection: (_port: number, _host: string, cb?: () => void) => {
    const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};

    const socket = {
      write: (_data: unknown) => true,
      destroy: () => {},
      on: (event: string, fn: (...a: unknown[]) => void) => {
        (handlers[event] ||= []).push(fn);
        return socket;
      },
      once: (event: string, fn: (...a: unknown[]) => void) => {
        const wrap = (...a: unknown[]) => {
          fn(...a);
          handlers[event] = (handlers[event] || []).filter(f => f !== wrap);
        };
        (handlers[event] ||= []).push(wrap);
        return socket;
      },
    };

    Promise.resolve().then(() => {
      if (mqtt_state.emit_error) {
        (handlers["error"] || []).forEach(fn => fn(new Error(mqtt_state.error_msg)));
        return;
      }
      if (cb) cb();

      // CONNACK 전송
      if (mqtt_state.send_connack) {
        Promise.resolve().then(() => {
          (handlers["data"] || []).forEach(fn => fn(CONNACK));

          // subscribe 테스트: SUBACK 후 PUBLISH 메시지 발송
          if (mqtt_state.send_publish) {
            Promise.resolve().then(() => {
              const pub = make_publish_packet(mqtt_state.publish_topic, mqtt_state.publish_payload);
              (handlers["data"] || []).forEach(fn => fn(pub));
            });
          }
        });
      }
    });

    return socket as unknown as ReturnType<typeof import("node:net").createConnection>;
  },
}));

// ── 임포트 ────────────────────────────────────────────

const { MqttTool } = await import("@src/agent/tools/mqtt.js");

function make_tool() { return new MqttTool(); }

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("MqttTool — 메타데이터", () => {
  it("name = mqtt", () => expect(make_tool().name).toBe("mqtt"));
  it("category = external", () => expect(make_tool().category).toBe("external"));
  it("to_schema type = function", () => expect(make_tool().to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// 파라미터 검증
// ══════════════════════════════════════════

describe("MqttTool — 파라미터 검증", () => {
  beforeEach(() => { mqtt_state.emit_error = false; });

  it("host 없음 → Error", async () => {
    const tool = make_tool();
    const r = await tool.execute({ action: "publish", host: "", topic: "test" });
    expect(String(r)).toContain("Error");
  });

  it("publish: topic 없음 → Error", async () => {
    const tool = make_tool();
    const r = await tool.execute({ action: "publish", host: "localhost" });
    expect(String(r)).toContain("Error");
  });

  it("subscribe: topic 없음 → Error", async () => {
    const tool = make_tool();
    const r = await tool.execute({ action: "subscribe", host: "localhost" });
    expect(String(r)).toContain("Error");
  });
});

// ══════════════════════════════════════════
// info action
// ══════════════════════════════════════════

describe("MqttTool — info action", () => {
  it("info → host/port/client_id 반환", async () => {
    const tool = make_tool();
    const r = JSON.parse(await tool.execute({ action: "info", host: "mqtt.example.com", port: 1883 }));
    expect(r.host).toBe("mqtt.example.com");
    expect(r.port).toBe(1883);
    expect(r.note).toBeTruthy();
  });
});

// ══════════════════════════════════════════
// publish action
// ══════════════════════════════════════════

describe("MqttTool — publish", () => {
  beforeEach(() => {
    mqtt_state.emit_error = false;
    mqtt_state.send_connack = true;
    mqtt_state.send_publish = false;
  });

  it("CONNACK 수신 후 publish 성공", async () => {
    const tool = make_tool();
    const r = JSON.parse(await tool.execute({ action: "publish", host: "localhost", topic: "sensors/temp", message: "22.5" }));
    expect(r.success).toBe(true);
    expect(r.topic).toBe("sensors/temp");
  });

  it("QoS 파라미터 (0/1/2) 지원", async () => {
    const tool = make_tool();
    const r = JSON.parse(await tool.execute({ action: "publish", host: "localhost", topic: "t", message: "m", qos: 1 }));
    expect(r.success).toBe(true);
  });

  it("username/password 포함 연결", async () => {
    const tool = make_tool();
    const r = JSON.parse(await tool.execute({
      action: "publish", host: "localhost", topic: "t", message: "m",
      username: "user1", password: "pass1",
    }));
    expect(r.success).toBe(true);
  });

  it("연결 오류 → success=false", async () => {
    mqtt_state.emit_error = true;
    const tool = make_tool();
    const r = JSON.parse(await tool.execute({ action: "publish", host: "localhost", topic: "t", message: "m" }));
    expect(r.success).toBe(false);
  });
});

// ══════════════════════════════════════════
// subscribe action
// ══════════════════════════════════════════

describe("MqttTool — subscribe", () => {
  beforeEach(() => {
    mqtt_state.emit_error = false;
    mqtt_state.send_connack = true;
  });

  it("메시지 수신 → success=true", async () => {
    mqtt_state.send_publish = true;
    mqtt_state.publish_topic = "sensors/temp";
    mqtt_state.publish_payload = "25.0";

    const tool = make_tool();
    const r = JSON.parse(await tool.execute({
      action: "subscribe", host: "localhost", topic: "sensors/temp",
      timeout_ms: 2000,
    }));
    expect(r.success).toBe(true);
    expect(r.message).toBe("25.0");
  });

  it("timeout 내 메시지 없음 → success=false", async () => {
    mqtt_state.send_publish = false;
    const tool = make_tool();
    const r = JSON.parse(await tool.execute({
      action: "subscribe", host: "localhost", topic: "t",
      timeout_ms: 100,
    }));
    expect(r.success).toBe(false);
    expect(r.error).toContain("timeout");
  });

  it("연결 오류 → success=false", async () => {
    mqtt_state.emit_error = true;
    const tool = make_tool();
    const r = JSON.parse(await tool.execute({ action: "subscribe", host: "localhost", topic: "t" }));
    expect(r.success).toBe(false);
  });
});

// ══════════════════════════════════════════
// unknown action
// ══════════════════════════════════════════

describe("MqttTool — unknown action", () => {
  it("지원하지 않는 action → Error", async () => {
    const tool = make_tool();
    const r = await tool.execute({ action: "bogus", host: "localhost" });
    expect(String(r)).toContain("Error");
  });
});
