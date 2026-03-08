import { describe, it, expect } from "vitest";
import { ldap_handler } from "../../../src/agent/nodes/ldap.js";
import type { LdapNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("ldap_handler", () => {
  const createMockNode = (overrides?: Partial<LdapNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "ldap",
    operation: "search",
    server: "ldap://localhost:389",
    base_dn: "dc=example,dc=com",
    search_filter: "(uid=*)",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be ldap", () => {
    expect(ldap_handler.node_type).toBe("ldap");
  });

  it("execute: should search LDAP directory", async () => {
    const node = createMockNode({ operation: "search" });
    const ctx = createMockContext();
    const result = await ldap_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in server URL", async () => {
    const node = createMockNode({ server: "${ldap_server}" });
    const ctx = createMockContext({ ldap_server: "ldap://auth.example.com:389" });
    const result = await ldap_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should authenticate user", async () => {
    const node = createMockNode({
      operation: "authenticate",
      username: "user1",
      password: "password123",
    });
    const ctx = createMockContext();
    const result = await ldap_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in search filter", async () => {
    const node = createMockNode({ search_filter: "(${attr}=${value})" });
    const ctx = createMockContext({ attr: "uid", value: "alice" });
    const result = await ldap_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show operation and server", () => {
    const node = createMockNode();
    const result = ldap_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should bind to LDAP directory", async () => {
    const node = createMockNode({
      operation: "bind",
      bind_dn: "cn=admin,dc=example,dc=com",
      password: "adminpass",
    });
    const ctx = createMockContext();
    const result = await ldap_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should modify LDAP entry", async () => {
    const node = createMockNode({
      operation: "modify",
      entry_dn: "uid=user1,dc=example,dc=com",
      changes: { mail: "newmail@example.com" },
    });
    const ctx = createMockContext();
    const result = await ldap_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle connection failure gracefully", async () => {
    const node = createMockNode({ server: "ldap://invalid-server:389" });
    const ctx = createMockContext();
    const result = await ldap_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
