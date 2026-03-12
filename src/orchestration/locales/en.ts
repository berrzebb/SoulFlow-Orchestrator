import type { ClassifierLocale } from "../classifier-locale.js";

/** English classifier locale. */
export const en: ClassifierLocale = {
  identity_phrases: [
    "who are you", "what are you", "introduce yourself",
  ],
  inquiry_phrases: [
    "what's the status", "how's the task", "task done", "task finished",
    "is it done", "task progress", "background task status",
    "cancel task", "stop task", "cancel it", "stop it",
  ],
  connector_tokens: ["then"],
  connector_phrases: ["and then", "after that"],
  task_signal_phrases: ["background", "async", "schedule", "notify when done", "run in background"],
  tool_pairs: [
    ["file", "send"], ["read", "summar"], ["search", "send"], ["fetch", "save"],
  ],
  task_mention_patterns: [
    "task.{0,10}id", "started.{0,10}task", "background.task",
  ],
  assistant_info_request_patterns: [
    "tell\\s*me", "let\\s*me\\s*know", "what\\s*is", "where\\s*is", "which\\s*one",
  ],
  user_context_reference_patterns: [
    "based\\s*on\\s*that", "from\\s*there", "near\\s*here", "around\\s*here",
    "nearby", "around\\s*there",
  ],
};
