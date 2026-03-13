/** Dashboard ops — re-export barrel. */

export { create_template_ops } from "./template.js";
export { create_channel_ops } from "./channel.js";
export { create_agent_provider_ops } from "./agent-provider.js";
export { create_bootstrap_ops } from "./bootstrap.js";
export { create_memory_ops } from "./memory.js";
export { create_workspace_ops } from "./workspace.js";
export { create_oauth_ops } from "./oauth.js";
export { create_config_ops } from "./config.js";
export { create_skill_ops, create_scoped_skill_ops, type SkillsLoaderLike } from "./skill.js";
export { create_tool_ops } from "./tool.js";
export { create_cli_auth_ops } from "./cli-auth.js";
export { create_model_ops } from "./model.js";
export { create_workflow_ops } from "./workflow.js";
export { create_agent_definition_ops, type DashboardAgentDefinitionOps, type AgentGenerateFn } from "./agent-definition.js";
