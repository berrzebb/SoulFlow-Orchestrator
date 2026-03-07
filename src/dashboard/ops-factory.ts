/** Dashboard ops 팩토리 — re-export facade. 실제 구현은 ops/ 디렉터리에 위치. */

export {
  create_template_ops,
  create_channel_ops,
  create_agent_provider_ops,
  create_bootstrap_ops,
  create_memory_ops,
  create_workspace_ops,
  create_oauth_ops,
  create_config_ops,
  create_skill_ops,
  type SkillsLoaderLike,
  create_tool_ops,
  create_cli_auth_ops,
  create_model_ops,
  create_workflow_ops,
} from "./ops/index.js";
