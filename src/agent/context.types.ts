export type AgentContextSnapshot = {
  agentId: string;
  teamId?: string;
  summary: string;
  facts: string[];
  bootstrap?: {
    templates: Record<string, string>;
    injectedAt: string;
  };
  memory?: Record<string, unknown>;
  skills?: string[];
  tools?: string[];
  updatedAt: string;
};

export type ContextMessage = Record<string, unknown>;

