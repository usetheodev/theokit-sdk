# Error codes

Every `code` this SDK puts on a thrown or reported error, the class that carries it, and where it is raised. **Generated from the source AST** by `tools/generate-error-codes.mjs` — do not edit by hand.

Branch on `code`, never on the message: messages carry context (an id, a path, a limit) and change with it, while a code is the contract. `err.code === "context_too_long"` keeps working when the message gains a token count.

**Transport codes vs the rest.** `ErrorCode` in `errors.ts` is the small canonical union a provider failure maps onto — the codes marked *transport* below. Everything else is raised by a specific subsystem at a specific place, and a `catch` that only handles the union will meet them anyway.

202 distinct code(s).

| Code | Kind | Raised by | Sites |
|---|---|---|---|
| `aborted` | domain | TheokitAgentError | `packages/sdk/src/batch.ts:280` +1 |
| `agent_disposed` | domain | — | `packages/sdk/src/errors.ts:668` |
| `agent_id_already_exists` | domain | ConfigurationError | `packages/sdk/src/agent-helpers.ts:54` |
| `agent_not_registered` | domain | UnknownAgentError | `packages/sdk/src/internal/cron/run-job.ts:61` |
| `agent_rehydration_failed` | domain | UnknownAgentError | `packages/sdk/src/agent-helpers.ts:300` |
| `anthropic_auth_failed` | domain | AuthenticationError | `packages/sdk/src/internal/error-mappers/anthropic.ts:56` |
| `anthropic_rate_limit` | domain | RateLimitError | `packages/sdk/src/internal/error-mappers/anthropic.ts:59` |
| `anthropic_server_error` | domain | NetworkError | `packages/sdk/src/internal/error-mappers/anthropic.ts:71` |
| `anthropic_timeout` | domain | NetworkError | `packages/sdk/src/internal/error-mappers/anthropic.ts:68` |
| `anthropic_unknown` | domain | UnknownAgentError | `packages/sdk/src/internal/error-mappers/anthropic.ts:73` |
| `artifact_path_traversal` | domain | ConfigurationError | `packages/sdk/src/internal/cloud-agent/cloud-agent.ts:260` |
| `auth_failed` | transport | ConfigurationError, MemoryAdapterError | `packages/memory-honcho/src/adapter.ts:237` +10 |
| `auth_permission` | domain | — | `packages/sdk/src/internal/error-mappers/vertex.ts:48` |
| `auth_unauthenticated` | domain | — | `packages/sdk/src/internal/error-mappers/vertex.ts:47` |
| `authentication_error` | domain | AuthenticationError | `packages/sdk/src/theokit.ts:235` |
| `before_complete_failed` | domain | — | `packages/sdk/src/internal/local-agent/local-run.ts:111` |
| `budget_exceeded` | domain | — | `packages/sdk/src/errors.ts:639` +1 |
| `budget_op_unsupported` | domain | — | `packages/sdk/src/errors.ts:695` +1 |
| `catastrophic_command` | domain | — | `packages/sdk-tools/src/internal/shell-guard.ts:32` |
| `circuit_open` | domain | NetworkError | `packages/sdk/src/internal/llm/pool-aware-client.ts:105` |
| `cloud_custom_tools_rejected` | domain | ConfigurationError | `packages/sdk/src/internal/cloud-agent/cloud-agent.ts:123` +1 |
| `cloud_incompatible_function_resolver` | domain | ConfigurationError | `packages/sdk/src/internal/cloud-agent/cloud-tool-parity.ts:43` +2 |
| `cloud_incompatible_mcp_stdio_local` | domain | ConfigurationError | `packages/sdk/src/internal/cloud-agent/cloud-tool-parity.ts:74` |
| `cloud_plugin_path_rejected` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/plugins/plugins-manager.ts:129` +1 |
| `cloud_run_http_error` | domain | NetworkError | `packages/sdk/src/internal/cloud-agent/real-cloud-run.ts:155` |
| `cloud_run_unknown_status` | domain | NetworkError | `packages/sdk/src/internal/cloud-agent/real-cloud-run.ts:284` +1 |
| `cloud_runtime_pre_release` | domain | ConfigurationError | `packages/sdk/src/agent.ts:415` +2 |
| `cloud_stdio_cwd_rejected` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/validation/validate-agent-options.ts:118` |
| `content_filtered` | transport | — | `packages/sdk/src/errors.ts:0` |
| `context_config_shape` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/context/context-manager.ts:252` |
| `context_frontmatter_invalid` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/context/context-frontmatter.ts:38` |
| `context_json_invalid` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/context/context-manager.ts:246` |
| `context_read_error` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/context/context-manager.ts:233` |
| `context_sources_shape` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/context/context-manager.ts:273` |
| `context_too_long` | transport | — | `packages/sdk/src/errors.ts:0` |
| `credential_pool_ambiguous` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/validation/validate-agent-options.ts:65` +1 |
| `credential_pool_empty` | domain | ConfigurationError | `packages/sdk/src/internal/llm/credential-pool.ts:91` |
| `cron_ambiguous_target` | domain | ConfigurationError | `packages/sdk/src/cron.ts:214` |
| `cron_missing_message` | domain | ConfigurationError | `packages/sdk/src/cron.ts:232` +1 |
| `cron_no_target` | domain | ConfigurationError | `packages/sdk/src/cron.ts:220` +1 |
| `cron_workflow_message` | domain | ConfigurationError | `packages/sdk/src/cron.ts:226` |
| `duplicate_tool_name` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/validation/validate-agent-options.ts:168` |
| `embedding_dimension_mismatch` | domain | ConfigurationError | `packages/sdk/src/internal/memory/lance-index.ts:142` +1 |
| `embedding_invalid_response` | domain | NetworkError | `packages/sdk/src/internal/memory/adapters/openai-compatible.ts:370` |
| `embedding_missing_api_key` | domain | AuthenticationError | `packages/sdk/src/internal/memory/adapters/openai-compatible.ts:129` |
| `embedding_unknown_model` | domain | ConfigurationError | `packages/sdk/src/internal/memory/adapters/openai-compatible.ts:141` |
| `fallback_empty_chain` | domain | NetworkError | `packages/sdk/src/internal/llm/fallback-client.ts:43` |
| `filesystem_io` | domain | FilesystemError | `packages/sdk/src/filesystem/types.ts:91` |
| `filesystem_not_found` | domain | FileNotFoundError | `packages/sdk/src/filesystem/types.ts:77` |
| `filesystem_readonly` | domain | FilesystemReadOnlyError | `packages/sdk/src/filesystem/types.ts:68` |
| `filesystem_security` | domain | FilesystemSecurityError | `packages/sdk/src/filesystem/types.ts:59` |
| `filesystem_stale` | domain | StaleFileError | `packages/sdk/src/filesystem/types.ts:111` |
| `forbidden_path` | domain | — | `packages/sdk/src/internal/security/path-guard.ts:57` +1 |
| `handoff_package_missing` | domain | ConfigurationError | `packages/sdk/src/agent-helpers.ts:104` +1 |
| `handoff_target_invalid` | domain | ConfigurationError | `packages/sdk-handoff/src/handoff.ts:115` |
| `handoff_target_required` | domain | ConfigurationError | `packages/sdk-handoff/src/handoff.ts:110` |
| `hitl_timeout` | domain | HitlTimeoutError | `packages/sdk/src/internal/runtime/tools/hitl-middleware.ts:39` |
| `hook_denied` | domain | ConfigurationError | `packages/sdk/src/internal/local-agent/local-agent.ts:424` |
| `hooks_invalid_command` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/hooks/hooks-source.ts:189` |
| `hooks_json_invalid` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/hooks/hooks-source.ts:107` +2 |
| `hooks_read_error` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/hooks/hooks-source.ts:98` |
| `hooks_unsupported_type` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/hooks/hooks-source.ts:183` |
| `interactive_unavailable` | domain | InteractiveUnavailableError | `packages/sdk/src/interactive/types.ts:20` |
| `INTERNAL_SERVER_ERROR` | domain | — | `packages/sdk/src/server/errors-envelope.ts:100` |
| `invalid_argument` | domain | TheokitAgentError | `packages/sdk/src/compaction.ts:79` |
| `invalid_batch_item` | domain | ConfigurationError | `packages/sdk/src/batch.ts:64` |
| `invalid_budget_name` | domain | ConfigurationError | `packages/sdk/src/internal/budget/registry.ts:28` +5 |
| `invalid_categories` | domain | ConfigurationError | `packages/sdk-memory/src/internal/categorized-memory.ts:120` +3 |
| `invalid_concurrency` | domain | ConfigurationError | `packages/sdk/src/batch.ts:55` +1 |
| `invalid_context_window_margin` | domain | — | `packages/sdk/src/compaction.ts:278` +1 |
| `invalid_cron` | domain | ConfigurationError | `packages/sdk/src/internal/cron/validate.ts:34` +3 |
| `invalid_doom_loop_threshold` | domain | ConfigurationError | `packages/sdk/src/internal/agent-loop/doom-loop-tracker.ts:47` |
| `invalid_filename_id` | domain | ConfigurationError | `packages/sdk/src/internal/security/path-guard.ts:474` |
| `invalid_identifier` | domain | ConfigurationError | `packages/sdk/src/internal/security/path-guard.ts:430` +1 |
| `invalid_input` | domain | MemoryAdapterError | `packages/memory-honcho/src/adapter.ts:98` +9 |
| `invalid_max_iterations` | domain | ConfigurationError | `packages/sdk/src/internal/local-agent/real-local-run.ts:206` |
| `invalid_memory_backend` | domain | ConfigurationError | `packages/sdk/src/internal/memory/index-manager-dispatch.ts:24` +1 |
| `invalid_model_selection` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/model-selection.ts:21` |
| `invalid_request` | transport | — | `packages/sdk/src/internal/error-mappers/vertex.ts:52` +1 |
| `invalid_retry_config` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/retry/with-retry.ts:67` |
| `invalid_squad` | domain | ConfigurationError | `packages/sdk/src/squad.ts:112` |
| `invalid_task_id` | domain | — | `packages/sdk/src/errors.ts:564` +1 |
| `invalid_timezone` | domain | ConfigurationError | `packages/sdk/src/internal/cron/validate.ts:134` |
| `iteration_limit_reached` | domain | — | `packages/sdk/src/internal/agent-loop/loop.ts:149` |
| `judge_credential` | domain | — | `packages/sdk/src/internal/judge/judge-call.ts:72` +1 |
| `lance_backend_unavailable` | domain | ConfigurationError | `packages/sdk/src/internal/memory/lance-index.ts:102` +3 |
| `lance_requires_embedding` | domain | ConfigurationError | `packages/sdk/src/internal/memory/index-manager-dispatch.ts:39` +1 |
| `live_session_protected` | domain | — | `packages/sdk/src/internal/persistence/transcript-ops.ts:39` +1 |
| `local_provider_http_error` | domain | ConfigurationError | `packages/sdk/src/internal/catalog/local-models.ts:61` |
| `local_provider_unreachable` | domain | ConfigurationError | `packages/sdk/src/internal/catalog/local-models.ts:46` |
| `malformed_api_key` | domain | AuthenticationError | `packages/sdk/src/agent-helpers.ts:195` +1 |
| `max_delegation_depth` | domain | MaxDelegationDepthError | `packages/sdk/src/a2a/subagent.ts:200` |
| `mcp_buffer_overflow` | domain | NetworkError | `packages/sdk/src/internal/mcp/client.ts:314` |
| `mcp_closed` | domain | NetworkError | `packages/sdk/src/internal/mcp/client.ts:289` |
| `mcp_crashed` | domain | NetworkError | `packages/sdk/src/internal/mcp/client.ts:208` |
| `mcp_disconnected` | domain | NetworkError | `packages/sdk/src/internal/mcp/client.ts:221` +2 |
| `mcp_http_error` | domain | NetworkError | `packages/sdk/src/internal/mcp/client.ts:478` +1 |
| `mcp_not_init` | domain | ConfigurationError | `packages/sdk/src/internal/mcp/client.ts:251` +2 |
| `mcp_timeout` | domain | NetworkError | `packages/sdk/src/internal/mcp/client.ts:71` |
| `memory_context_missing_user_id` | domain | ConfigurationError | `packages/sdk/src/internal/local-agent/local-agent-memory-direct.ts:93` |
| `memory_path_escapes_root` | domain | ConfigurationError | `packages/sdk/src/internal/memory/tools.ts:109` +1 |
| `memory_path_traversal` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/validation/validate-agent-options.ts:247` |
| `memory_tool_bad_args` | domain | ConfigurationError | `packages/sdk/src/internal/memory/tools.ts:132` +1 |
| `migration_destination_exists` | domain | ConfigurationError | `packages/sdk/src/internal/memory/migrate-sqlite-to-lance.ts:114` +1 |
| `missing_api_key` | domain | AuthenticationError, ConfigurationError | `packages/sdk/src/agent-helpers.ts:183` +2 |
| `missing_frontmatter` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/skills/skill-frontmatter.ts:66` |
| `missing_model` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/validation/validate-agent-options.ts:32` |
| `model_unavailable` | transport | buildErrorMetadata | `packages/sdk/src/internal/error-mappers/ollama.ts:75` +1 |
| `network` | transport | MemoryAdapterError, buildErrorMetadata | `packages/memory-honcho/src/adapter.ts:258` +5 |
| `network_error` | domain | NetworkError | `packages/sdk/src/internal/http.ts:98` |
| `no_api_key` | domain | ConfigurationError | `packages/sdk-tools/src/web-search-brave.ts:50` |
| `no_memory_adapter` | domain | ConfigurationError | `packages/sdk/src/internal/local-agent/local-agent-memory-direct.ts:104` +1 |
| `no_such_session` | domain | NoSuchSessionError | `packages/sdk/src/interactive/types.ts:30` |
| `no_tool_call` | domain | — | `packages/sdk/src/agent-generate.ts:88` |
| `node_ws_invalid_raw` | domain | SubscriptionError | `packages/sdk/src/subscription/internal/ws-adapter-node.ts:107` |
| `not_found` | domain | MemoryAdapterError | `packages/memory-honcho/src/adapter.ts:251` +2 |
| `oauth_bind_failed` | domain | ConfigurationError | `packages/sdk/src/internal/mcp/oauth.ts:226` |
| `oauth_refresh_failed` | domain | ConfigurationError | `packages/sdk/src/internal/mcp/oauth.ts:52` |
| `oauth_state_mismatch` | domain | ConfigurationError | `packages/sdk/src/internal/mcp/oauth.ts:127` |
| `oauth_timeout` | domain | ConfigurationError | `packages/sdk/src/internal/mcp/oauth.ts:216` +1 |
| `oauth_token_exchange_failed` | domain | ConfigurationError | `packages/sdk/src/internal/mcp/oauth.ts:148` |
| `ollama_image_unsupported` | domain | ConfigurationError | `packages/sdk/src/internal/llm/ollama-native.ts:304` |
| `ollama_model_loading` | domain | NetworkError | `packages/sdk/src/internal/error-mappers/ollama.ts:101` |
| `ollama_model_not_pulled` | domain | ConfigurationError | `packages/sdk/src/internal/error-mappers/ollama.ts:84` |
| `ollama_unreachable` | domain | ConfigurationError | `packages/sdk/src/internal/error-mappers/ollama.ts:55` +1 |
| `pagination_invalid` | domain | ConfigurationError | `packages/sdk/src/internal/persistence/pagination.ts:34` |
| `parse_failed` | domain | — | `packages/sdk/src/agent-generate.ts:88` |
| `path_traversal` | domain | — | `packages/sdk/src/internal/security/path-guard.ts:37` |
| `permission_enforcement_unavailable` | domain | ConfigurationError | `packages/acp/src/permission-plugin.ts:138` +1 |
| `personality_empty_body` | domain | ConfigurationError | `packages/sdk/src/internal/personality/registry.ts:115` |
| `personality_not_found` | domain | ConfigurationError | `packages/sdk/src/internal/personality/switch.ts:60` |
| `personality_reserved_name` | domain | ConfigurationError | `packages/sdk/src/internal/personality/registry.ts:108` |
| `pipeline_duplicate_provider` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/system-prompt/pipeline.ts:33` |
| `plugin_entry_missing` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/plugins/plugins-manager.ts:104` |
| `plugin_frontmatter_invalid` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/plugins/plugin-frontmatter.ts:39` |
| `plugin_late_register_kind` | domain | ConfigurationError | `packages/sdk/src/internal/plugins/manager.ts:103` |
| `plugin_manifest_invalid` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/plugins/plugins-manager.ts:154` |
| `plugin_manifest_shape` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/plugins/plugins-manager.ts:160` |
| `plugin_missing_manifest` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/plugins/plugins-manager.ts:145` +2 |
| `programmatic_hooks_rejected` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/validation/validate-agent-options.ts:94` |
| `provider_unresolved` | domain | ConfigurationError | `packages/sdk/src/internal/llm/router.ts:90` +1 |
| `quota_exceeded` | transport | — | `packages/sdk/src/errors.ts:0` |
| `rate_limit` | transport | — | `packages/sdk/src/internal/error-mappers/vertex.ts:46` |
| `rate_limited` | domain | MemoryAdapterError | `packages/memory-honcho/src/adapter.ts:244` +3 |
| `redirect_blocked` | domain | — | `packages/sdk-tools/src/internal/network-guard.ts:38` |
| `repo_provision_failed` | domain | — | `packages/sdk/src/sandbox/provision.ts:33` |
| `reserved_env_prefix` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/validation/validate-agent-options.ts:105` |
| `run_not_found` | domain | UnknownAgentError | `packages/sdk/src/agent.ts:422` |
| `runtime_exclusive` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/validation/validate-agent-options.ts:85` |
| `sandbox_not_available` | domain | SandboxNotAvailableError | `packages/sdk/src/sandbox/types.ts:89` |
| `sandbox_security` | domain | SandboxSecurityError | `packages/sdk/src/sandbox/types.ts:71` |
| `schema_invalid` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/skills/skill-frontmatter.ts:77` +3 |
| `server_error` | transport | buildErrorMetadata | `packages/sdk/src/internal/error-mappers/ollama.ts:92` +2 |
| `session_busy` | domain | — | `packages/sdk/src/internal/persistence/session-writer.ts:56` +1 |
| `sql_injection_blocked` | domain | ConfigurationError | `packages/sdk/src/internal/memory/lance-index.ts:252` +3 |
| `sqlite_driver_unavailable` | domain | ConfigurationError | `packages/sdk/src/internal/persistence/sqlite-open.ts:192` |
| `sqlite_vec_unavailable` | domain | ConfigurationError | `packages/sdk/src/internal/memory/sqlite-vec-loader.ts:23` +1 |
| `squad_process_unsupported` | domain | ConfigurationError | `packages/sdk/src/squad.ts:117` |
| `sse_http_error` | domain | SubscriptionError | `packages/sdk/src/subscription/theokit-subscribe.ts:146` |
| `sse_server_error` | domain | SubscriptionError | `packages/sdk/src/subscription/theokit-subscribe.ts:154` |
| `ssrf_blocked` | domain | — | `packages/sdk-tools/src/internal/network-guard.ts:23` |
| `stream_idle_timeout` | domain | NetworkError | `packages/sdk/src/internal/llm/sse.ts:95` |
| `stream_truncated` | domain | NetworkError | `packages/sdk/src/internal/llm/anthropic.ts:184` +1 |
| `subagent_mcp_unsupported_local` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/skills/subagents-loader.ts:111` |
| `subagent_missing_description` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/validation/validate-agent-options.ts:139` |
| `subagent_missing_frontmatter` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/skills/subagents-loader.ts:183` |
| `subagent_missing_prompt` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/validation/validate-agent-options.ts:144` |
| `subagent_reasoning_effort_without_model` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/skills/subagents-loader.ts:131` |
| `subagent_sandbox_not_boolean` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/skills/subagents-loader.ts:151` |
| `subagent_unknown_field` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/skills/subagents-loader.ts:96` |
| `subagent_unknown_setting_source` | domain | ConfigurationError | `packages/sdk/src/subagents-loader.ts:61` |
| `subscribe_baseUrl_missing` | domain | SubscriptionError | `packages/sdk/src/subscription/theokit-subscribe.ts:77` |
| `subscribe_name_invalid` | domain | SubscriptionError | `packages/sdk/src/subscription/theokit-subscribe.ts:72` |
| `subscription_descriptor_invalid` | domain | SubscriptionError | `packages/sdk/src/subscription/internal/server-integration.ts:166` |
| `subscription_disconnected` | domain | — | `packages/sdk/src/subscription/types.ts:147` |
| `subscription_duplicate` | domain | SubscriptionError | `packages/sdk/src/subscription/internal/subscription-runtime.ts:82` |
| `subscription_input_invalid` | domain | — | `packages/sdk/src/subscription/types.ts:126` |
| `subscription_not_found` | domain | SubscriptionError | `packages/sdk/src/subscription/internal/subscription-runtime.ts:111` |
| `task_not_found` | domain | — | `packages/sdk/src/errors.ts:584` +1 |
| `task_op_unsupported` | domain | — | `packages/sdk/src/errors.ts:604` +1 |
| `timeout` | transport | — | `packages/sdk/src/internal/error-mappers/vertex.ts:54` |
| `tool_invalid_name` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/validation/validate-agent-options.ts:206` |
| `tool_invalid_schema_type` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/validation/validate-agent-options.ts:235` |
| `tool_missing_description` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/validation/validate-agent-options.ts:221` |
| `tool_missing_handler` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/validation/validate-agent-options.ts:193` |
| `tool_missing_name` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/validation/validate-agent-options.ts:201` |
| `tool_missing_schema` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/validation/validate-agent-options.ts:230` |
| `tool_reserved_name` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/validation/validate-agent-options.ts:212` |
| `transport_failure` | domain | NetworkError | `packages/sdk/src/internal/llm/transport-error.ts:45` |
| `transport_unavailable` | domain | ConfigurationError | `packages/sdk/src/internal/llm/router.ts:453` +1 |
| `unknown` | transport | AgentRunError, MemoryAdapterError, TheokitAgentError | `packages/memory-honcho/src/adapter.ts:264` +5 |
| `unknown_agent` | domain | UnknownAgentError | `packages/sdk/src/agent-helpers.ts:379` +1 |
| `unknown_artifact` | domain | UnknownAgentError | `packages/sdk/src/internal/cloud-agent/cloud-agent.ts:279` |
| `unknown_category` | domain | ConfigurationError | `packages/sdk-memory/src/internal/categorized-memory.ts:76` |
| `unknown_cron_job` | domain | UnknownAgentError | `packages/sdk/src/cron.ts:84` +2 |
| `unsafe_filename` | domain | ConfigurationError | `packages/sdk/src/internal/runtime/context/project-instructions.ts:120` |
| `work_threw` | domain | — | `packages/sdk/src/internal/task/registry.ts:295` |
| `workflow_tool_failed` | domain | WorkflowToolError | `packages/sdk/src/workflow.ts:598` |
| `ws_global_missing` | domain | SubscriptionError | `packages/sdk/src/subscription/theokit-subscribe.ts:183` |
| `ws_peer_missing` | domain | SubscriptionError | `packages/sdk/src/subscription/internal/ws-adapter-node.ts:48` |
| `ws_server_error` | domain | SubscriptionError | `packages/sdk/src/subscription/theokit-subscribe.ts:251` |
| `zod_not_installed` | domain | ConfigurationError | `packages/sdk/src/internal/structured-output-helpers.ts:34` +1 |

