/** Template 노드 핸들러 테스트
 *
 * 목표: template_handler를 통한 텍스트 템플릿 렌더링 검증
 *       - execute: {{memory.*}} 변수 해석 및 텍스트 렌더링
 *       - nested paths: {{memory.user.name}} 형식 지원
 *       - array access: {{memory.items[0].name}} 형식 지원
 *       - complex templates: 여러 변수, 텍스트 조합
 */

import { describe, it, expect } from "vitest";
import { template_handler } from "@src/agent/nodes/template.js";
import type { TemplateNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockTemplateNode = (overrides?: Partial<TemplateNodeDefinition>): TemplateNodeDefinition => ({
  node_id: "template-1",
  title: "Test Template Node",
  node_type: "template",
  template: "",
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    previous_output: {},
  },
  ...overrides,
});

/* ── Tests ── */

describe("Template Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(template_handler.node_type).toBe("template");
    });

    it("should have output_schema with text", () => {
      const schema = template_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("text");
    });

    it("should have create_default returning valid node template", () => {
      const defaultNode = template_handler.create_default?.();
      expect(defaultNode?.template).toBe("{{input}}");
    });
  });

  describe("execute — simple variable substitution", () => {
    it("should render simple variable", async () => {
      const node = createMockTemplateNode({
        template: "Hello {{memory.name}}",
      });
      const ctx = createMockContext({
        memory: { name: "World" },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toBe("Hello World");
    });

    it("should render multiple variables", async () => {
      const node = createMockTemplateNode({
        template: "{{memory.greeting}}, {{memory.name}}!",
      });
      const ctx = createMockContext({
        memory: { greeting: "Hello", name: "Alice" },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toBe("Hello, Alice!");
    });

    it("should handle empty template", async () => {
      const node = createMockTemplateNode({
        template: "",
      });
      const ctx = createMockContext();

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toBe("");
    });

    it("should render template with no variables", async () => {
      const node = createMockTemplateNode({
        template: "Static text",
      });
      const ctx = createMockContext();

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toBe("Static text");
    });
  });

  describe("execute — nested object access", () => {
    it("should access nested object properties", async () => {
      const node = createMockTemplateNode({
        template: "User: {{memory.user.name}}, Age: {{memory.user.age}}",
      });
      const ctx = createMockContext({
        memory: { user: { name: "John", age: 30 } },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toBe("User: John, Age: 30");
    });

    it("should access deeply nested properties", async () => {
      const node = createMockTemplateNode({
        template: "City: {{memory.user.address.city}}, Country: {{memory.user.address.country}}",
      });
      const ctx = createMockContext({
        memory: {
          user: { address: { city: "New York", country: "USA" } },
        },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toBe("City: New York, Country: USA");
    });

    it("should handle missing nested properties", async () => {
      const node = createMockTemplateNode({
        template: "Name: {{memory.user.name}}, Phone: {{memory.user.phone}}",
      });
      const ctx = createMockContext({
        memory: { user: { name: "John" } },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toContain("Name: John");
      expect(result.output.text).toContain("Phone:");
    });
  });

  describe("execute — array access", () => {
    it("should access array elements by index", async () => {
      const node = createMockTemplateNode({
        template: "First: {{memory.items[0]}}, Second: {{memory.items[1]}}",
      });
      const ctx = createMockContext({
        memory: { items: ["apple", "banana", "cherry"] },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toBe("First: apple, Second: banana");
    });

    it("should access object properties in array", async () => {
      const node = createMockTemplateNode({
        template: "First user: {{memory.users[0].name}}, Second user: {{memory.users[1].name}}",
      });
      const ctx = createMockContext({
        memory: {
          users: [{ name: "Alice" }, { name: "Bob" }, { name: "Charlie" }],
        },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toBe("First user: Alice, Second user: Bob");
    });

    it("should handle out-of-bounds array access", async () => {
      const node = createMockTemplateNode({
        template: "Item: {{memory.items[10]}}",
      });
      const ctx = createMockContext({
        memory: { items: ["a", "b"] },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toContain("Item:");
    });
  });

  describe("execute — complex templates", () => {
    it("should handle multi-line templates", async () => {
      const node = createMockTemplateNode({
        template: `Hello {{memory.name}},
Welcome to {{memory.place}}.
Age: {{memory.age}}`,
      });
      const ctx = createMockContext({
        memory: { name: "Alice", place: "NYC", age: 25 },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toContain("Hello Alice");
      expect(result.output.text).toContain("Welcome to NYC");
      expect(result.output.text).toContain("Age: 25");
    });

    it("should handle templates with special characters", async () => {
      const node = createMockTemplateNode({
        template: "Email: {{memory.email}}, URL: {{memory.url}}",
      });
      const ctx = createMockContext({
        memory: {
          email: "user@example.com",
          url: "https://example.com?key=value&other=123",
        },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toContain("user@example.com");
      expect(result.output.text).toContain("https://example.com");
    });

    it("should handle templates with braces in text", async () => {
      const node = createMockTemplateNode({
        template: "JSON: { name: {{memory.name}}, age: {{memory.age}} }",
      });
      const ctx = createMockContext({
        memory: { name: "John", age: 30 },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toContain("JSON: { name: John, age: 30 }");
    });

    it("should handle repeated variable references", async () => {
      const node = createMockTemplateNode({
        template: "{{memory.greeting}} {{memory.name}}, {{memory.greeting}} again {{memory.name}}!",
      });
      const ctx = createMockContext({
        memory: { greeting: "Hello", name: "World" },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toBe("Hello World, Hello again World!");
    });
  });

  describe("execute — data types", () => {
    it("should render numeric values", async () => {
      const node = createMockTemplateNode({
        template: "Count: {{memory.count}}, Price: {{memory.price}}",
      });
      const ctx = createMockContext({
        memory: { count: 42, price: 99.99 },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toBe("Count: 42, Price: 99.99");
    });

    it("should render boolean values", async () => {
      const node = createMockTemplateNode({
        template: "Active: {{memory.active}}, Verified: {{memory.verified}}",
      });
      const ctx = createMockContext({
        memory: { active: true, verified: false },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toContain("Active: true");
      expect(result.output.text).toContain("Verified: false");
    });

    it("should render null values", async () => {
      const node = createMockTemplateNode({
        template: "Value: {{memory.nullValue}}",
      });
      const ctx = createMockContext({
        memory: { nullValue: null },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toContain("Value:");
    });

    it("should render arrays as string", async () => {
      const node = createMockTemplateNode({
        template: "Items: {{memory.items}}",
      });
      const ctx = createMockContext({
        memory: { items: ["a", "b", "c"] },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toContain("Items:");
    });

    it("should render objects as string", async () => {
      const node = createMockTemplateNode({
        template: "Data: {{memory.data}}",
      });
      const ctx = createMockContext({
        memory: { data: { key: "value" } },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toContain("Data:");
    });
  });

  describe("execute — edge cases", () => {
    it("should handle template with spaces around variable", async () => {
      const node = createMockTemplateNode({
        template: "Name: {{ memory.name }}",
      });
      const ctx = createMockContext({
        memory: { name: "John" },
      });

      const result = await template_handler.execute(node, ctx);

      // resolve_templates handles spaces in braces
      expect(result.output.text).toContain("Name:");
    });

    it("should handle adjacent variable references", async () => {
      const node = createMockTemplateNode({
        template: "{{memory.first}}{{memory.second}}",
      });
      const ctx = createMockContext({
        memory: { first: "Hello", second: "World" },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toBe("HelloWorld");
    });

    it("should handle very long template", async () => {
      let template = "Start: ";
      for (let i = 0; i < 100; i++) {
        template += `{{memory.var${i}}} `;
      }
      template += ":End";

      const node = createMockTemplateNode({ template });
      const memory: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        memory[`var${i}`] = `val${i}`;
      }
      const ctx = createMockContext({ memory });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toContain("Start:");
      expect(result.output.text).toContain(":End");
    });

    it("should handle undefined memory context variables", async () => {
      const node = createMockTemplateNode({
        template: "Name: {{memory.undefined}}, Age: {{memory.age}}",
      });
      const ctx = createMockContext({
        memory: { age: 25 },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toContain("Name:");
      expect(result.output.text).toContain("Age: 25");
    });
  });

  describe("execute — escaping and special patterns", () => {
    it("should handle literal braces in template", async () => {
      const node = createMockTemplateNode({
        template: "Use \\{\\{ to escape braces: {actual}",
      });
      const ctx = createMockContext();

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toContain("{actual}");
    });

    it("should handle URLs in template", async () => {
      const node = createMockTemplateNode({
        template: "Visit {{memory.domain}}/user/{{memory.id}}",
      });
      const ctx = createMockContext({
        memory: { domain: "example.com", id: "123" },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toBe("Visit example.com/user/123");
    });

    it("should handle markdown in template", async () => {
      const node = createMockTemplateNode({
        template: "# {{memory.title}}\n\n**Author:** {{memory.author}}",
      });
      const ctx = createMockContext({
        memory: { title: "My Article", author: "John Doe" },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toContain("# My Article");
      expect(result.output.text).toContain("**Author:** John Doe");
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid template", () => {
      const node = createMockTemplateNode({
        template: "Hello {{memory.name}}",
      });
      const ctx = createMockContext({
        memory: { name: "World" },
      });

      const result = template_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when template is empty", () => {
      const node = createMockTemplateNode({
        template: "",
      });
      const ctx = createMockContext();

      const result = template_handler.test(node, ctx);

      expect(result.warnings).toContain("template is empty");
    });

    it("should warn when template is whitespace only", () => {
      const node = createMockTemplateNode({
        template: "   \n  \t  ",
      });
      const ctx = createMockContext();

      const result = template_handler.test(node, ctx);

      expect(result.warnings).toContain("template is empty");
    });

    it("should include preview with template length and rendered content", () => {
      const node = createMockTemplateNode({
        template: "Hello {{memory.name}}!",
      });
      const ctx = createMockContext({
        memory: { name: "Alice" },
      });

      const result = template_handler.test(node, ctx);

      expect(result.preview.template_length).toBe("Hello {{memory.name}}!".length);
      expect(result.preview.rendered_preview).toContain("Hello Alice");
    });

    it("should truncate long rendered preview", () => {
      let template = "";
      for (let i = 0; i < 50; i++) {
        template += "Very long template text {{memory.var}} ";
      }

      const node = createMockTemplateNode({ template });
      const ctx = createMockContext({
        memory: { var: "value" },
      });

      const result = template_handler.test(node, ctx);

      expect(result.preview.rendered_preview.length).toBeLessThanOrEqual(200);
    });
  });

  describe("integration scenarios", () => {
    it("should generate report from data", async () => {
      const node = createMockTemplateNode({
        template: `Report for {{memory.company}}
- Total Users: {{memory.stats.users}}
- Active: {{memory.stats.active}}
- Revenue: {{memory.stats.revenue}}`,
      });
      const ctx = createMockContext({
        memory: {
          company: "Acme Corp",
          stats: { users: 1000, active: 750, revenue: 50000 },
        },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toContain("Report for Acme Corp");
      expect(result.output.text).toContain("Total Users: 1000");
      expect(result.output.text).toContain("Revenue: 50000");
    });

    it("should generate email content", async () => {
      const node = createMockTemplateNode({
        template: `Dear {{memory.user.name}},

Thank you for signing up. Your confirmation code is: {{memory.code}}

Click here to confirm: {{memory.confirmUrl}}

Best regards,
{{memory.company}}`,
      });
      const ctx = createMockContext({
        memory: {
          user: { name: "John" },
          code: "ABC123",
          confirmUrl: "https://example.com/confirm?code=ABC123",
          company: "Example Inc",
        },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toContain("Dear John");
      expect(result.output.text).toContain("ABC123");
      expect(result.output.text).toContain("https://example.com/confirm");
    });

    it("should generate JSON from template", async () => {
      const node = createMockTemplateNode({
        template: `{
  "id": "{{memory.id}}",
  "name": "{{memory.name}}",
  "email": "{{memory.email}}"
}`,
      });
      const ctx = createMockContext({
        memory: { id: "123", name: "Alice", email: "alice@example.com" },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toContain('"id": "123"');
      expect(result.output.text).toContain('"name": "Alice"');
    });

    it("should generate CSV from template", async () => {
      const node = createMockTemplateNode({
        template: `id,name,email
{{memory.user1.id}},{{memory.user1.name}},{{memory.user1.email}}
{{memory.user2.id}},{{memory.user2.name}},{{memory.user2.email}}`,
      });
      const ctx = createMockContext({
        memory: {
          user1: { id: "1", name: "Alice", email: "alice@example.com" },
          user2: { id: "2", name: "Bob", email: "bob@example.com" },
        },
      });

      const result = await template_handler.execute(node, ctx);

      expect(result.output.text).toContain("id,name,email");
      expect(result.output.text).toContain("1,Alice,alice@example.com");
      expect(result.output.text).toContain("2,Bob,bob@example.com");
    });
  });
});
