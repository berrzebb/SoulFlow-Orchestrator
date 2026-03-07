import type { MessageBusLike, OutboundMessage } from "../../bus/index.js";
import type { CronScheduler } from "../../cron/contracts.js";
import { CronTool } from "./cron.js";
import { EditFileTool, ListDirTool, ReadFileTool, SearchFilesTool, WriteFileTool } from "./filesystem.js";
import { AskUserTool } from "./ask-user.js";
import { FileRequestTool } from "./file-request.js";
import { MessageTool } from "./message.js";
import { SendFileTool } from "./send-file.js";
import { SpawnTool, type SpawnRequest } from "./spawn.js";
import { ToolRegistry } from "./registry.js";
import { ExecTool } from "./shell.js";
import { WebBrowserTool, WebExtractTool, WebFetchTool, WebMonitorTool, WebPdfTool, WebSearchTool, WebSnapshotTool } from "./web.js";
import { ChainTool } from "./chain.js";
import { DiagramRenderTool } from "./diagram.js";
import { DynamicToolRuntimeLoader, ToolRuntimeReloader } from "./runtime-loader.js";
import { ToolInstallerService } from "./installer.js";
import { SqliteDynamicToolStore, type DynamicToolStoreLike } from "./store.js";
import { FileMcpServerStore } from "./mcp-store.js";
import { ToolSelfTestService } from "./self-test.js";
import { MemoryTool } from "./memory-tool.js";
import { DecisionTool } from "./decision-tool.js";
import { SecretTool } from "./secret-tool.js";
import { PromiseTool } from "./promise-tool.js";
import { RuntimeAdminTool } from "./runtime-admin.js";
import { DateTimeTool } from "./datetime.js";
import { HttpRequestTool } from "./http-request.js";
import { OAuthFetchTool } from "./oauth-fetch.js";
import { TaskQueryTool, type TaskQueryCallback } from "./task-query.js";
import { WorkflowTool } from "./workflow.js";
import { KanbanTool } from "./kanban.js";
import type { AppendWorkflowEventInput, AppendWorkflowEventResult } from "../../events/types.js";
import type { RuntimeExecutionPolicy } from "../../providers/types.js";
import type { PreToolHook, PostToolHook } from "./types.js";
import { build_approval_notifier } from "./approval-notifier.js";
import { GitTool } from "./git.js";
import { ArchiveTool } from "./archive.js";
import { ProcessManagerTool } from "./process-manager.js";
import { NotificationTool } from "./notification.js";
import { DockerTool } from "./docker.js";
import { WebTableTool } from "./web-table.js";
import { NetworkTool } from "./network.js";
import { WebFormTool } from "./web-form.js";
import { SystemInfoTool } from "./system-info.js";
import { PackageManagerTool as PkgManagerTool } from "./package-manager.js";
import { WebAuthTool } from "./web-auth.js";
import { CronShellTool } from "./cron-shell.js";
import { DataFormatTool } from "./data-format.js";
import { EncodingTool } from "./encoding.js";
import { RegexTool } from "./regex.js";
import { DiffTool } from "./diff.js";
import { ScreenshotTool } from "./screenshot.js";
import { DatabaseTool } from "./database.js";
import { TemplateTool } from "./template-engine.js";
import { ValidatorTool } from "./validator.js";
import { QueueTool } from "./queue.js";
import { CacheTool } from "./ttl-cache.js";
import { ImageTool } from "./image.js";
import { StatsTool } from "./stats.js";
import { TextTool } from "./text.js";
import { CompressTool } from "./compress.js";
import { MathTool } from "./math.js";
import { TableTool } from "./table.js";
import { EvalTool } from "./eval.js";
import { FormatTool } from "./format.js";
import { SetTool } from "./set.js";
import { LookupTool } from "./lookup.js";
import { MarkdownTool } from "./markdown.js";
import { EmbeddingTool } from "./embedding.js";
import { VectorStoreTool } from "./vector-store.js";
import { HashTool } from "./hash.js";
import { CryptoTool } from "./crypto.js";
import { FilterTool } from "./filter.js";
import { TransformTool } from "./transform.js";
import { JwtTool } from "./jwt.js";
import { GraphqlTool } from "./graphql.js";
import { EmailTool } from "./email.js";
import { WebhookTool } from "./webhook.js";
import { TextSplitterTool } from "./text-splitter.js";
import { RetrieverTool } from "./retriever.js";
import { AggregateTool } from "./aggregate.js";
import { AssertTool } from "./assert.js";
import { MediaTool } from "./media.js";
import { CsvTool } from "./csv.js";
import { WebSocketTool } from "./websocket.js";
import { PdfTool } from "./pdf.js";
import { RateLimitTool } from "./rate-limit.js";
import { XmlTool } from "./xml.js";
import { YamlTool } from "./yaml.js";
import { FtpTool } from "./ftp.js";
import { DnsTool } from "./dns.js";
import { SemverTool } from "./semver.js";
import { UuidTool } from "./uuid.js";
import { SshTool } from "./ssh.js";
import { S3Tool } from "./s3.js";
import { EnvTool } from "./env.js";
import { HtmlTool } from "./html.js";
import { JsonPatchTool } from "./json-patch.js";
import { TomlTool } from "./toml.js";
import { JsonlTool } from "./jsonl.js";
import { RandomTool } from "./random.js";
import { ColorTool } from "./color.js";
import { QrTool } from "./qr.js";
import { GeoTool } from "./geo.js";
import { MqttTool } from "./mqtt.js";
import { RedisTool } from "./redis.js";
import { HttpMockTool } from "./http-mock.js";
import { UrlTool } from "./url.js";
import { IpTool } from "./ip.js";
import { SqlBuilderTool } from "./sql-builder.js";
import { LogParserTool } from "./log-parser.js";
import { IniTool } from "./ini.js";
import { RssTool } from "./rss.js";
import { DotenvTool } from "./dotenv.js";
import { IcalTool } from "./ical.js";
import { BaseConvertTool } from "./base-convert.js";
import { SlugTool } from "./slug.js";
import { DurationTool } from "./duration.js";
import { LdapTool } from "./ldap.js";
import { SyslogTool } from "./syslog.js";
import { PrometheusTool } from "./prometheus.js";
import { JsonSchemaTool } from "./json-schema.js";
import { OpenApiTool } from "./openapi.js";
import { MimeTool } from "./mime.js";
import { UserAgentTool } from "./user-agent.js";
import { BarcodeTool } from "./barcode.js";
import { VcardTool } from "./vcard.js";
import { SitemapTool } from "./sitemap.js";
import { RobotsTxtTool } from "./robots-txt.js";
import { PhoneTool } from "./phone.js";
import { EmailValidateTool } from "./email-validate.js";
import { CountryTool } from "./country.js";
import { UnitConvertTool } from "./unit-convert.js";
import { HealthcheckTool } from "./healthcheck.js";
import { WhoisTool } from "./whois.js";
import { AsciiArtTool } from "./ascii-art.js";
import { CookieTool } from "./cookie.js";
import { CorsTool } from "./cors.js";
import { CspTool } from "./csp.js";
import { PasswordTool } from "./password.js";
import { ChangelogTool } from "./changelog.js";
import { LicenseTool } from "./license.js";
import { GlobMatchTool } from "./glob-match.js";
import { DependencyTool } from "./dependency.js";
import { MatrixTool } from "./matrix.js";
import { TimeseriesTool } from "./timeseries.js";
import { CurrencyTool } from "./currency.js";
import { TimezoneTool } from "./timezone.js";
import { MsgpackTool } from "./msgpack.js";
import { StateMachineTool } from "./state-machine.js";
import { ProtobufTool } from "./protobuf.js";
import { CodeDiagramTool } from "./code-diagram.js";
import { GraphTool } from "./graph.js";
import { TreeTool } from "./tree.js";
import { BloomFilterTool } from "./bloom-filter.js";
import { TokenizerTool } from "./tokenizer.js";
import { SentimentTool } from "./sentiment.js";
import { SimilarityTool } from "./similarity.js";
import { CircuitBreakerTool } from "./circuit-breaker.js";
import { MetricTool } from "./metric.js";
import { FeatureFlagTool } from "./feature-flag.js";
import { DataMaskTool } from "./data-mask.js";
import { ChecksumTool } from "./checksum.js";
import { HttpHeaderTool } from "./http-header.js";
import { PaginationTool } from "./pagination.js";
import { CrontabTool } from "./crontab.js";
import { SvgTool } from "./svg.js";

const DANGEROUS_COMMANDS = ["rm -rf", "drop table", "format c:", "mkfs", "dd if="];

/** RuntimeExecutionPolicy.sandbox 기반 PreToolHook. 도구의 policy_flags 메타데이터로 write/network 판정. */
export function create_policy_pre_hook(policy: RuntimeExecutionPolicy, registry?: ToolRegistry | null): PreToolHook {
  return (tool_name, params) => {
    const sandbox = policy.sandbox;
    if (!sandbox || sandbox.approval === "auto-approve") return { permission: "allow" };

    const tool = registry?.get(tool_name) ?? null;
    const flags = tool?.policy_flags;
    const is_write = !!flags?.write;
    const is_network = !!flags?.network;

    if (!sandbox.network_access && is_network) {
      return { permission: "deny", reason: `network access disabled: ${tool_name} blocked` };
    }

    if (sandbox.fs_access === "read-only" && is_write) {
      return { permission: "ask", reason: `read-only policy: ${tool_name} requires approval` };
    }

    if (sandbox.fs_access === "workspace-write" && tool_name === "exec") {
      const cmd = String(params.command || "").toLowerCase();
      if (DANGEROUS_COMMANDS.some((d) => cmd.includes(d))) {
        return { permission: "deny", reason: `dangerous command blocked: ${cmd.slice(0, 50)}` };
      }
    }

    if (sandbox.approval === "always-ask" && is_write) {
      return { permission: "ask", reason: `approval required: ${tool_name}` };
    }

    if (sandbox.approval === "trusted-only" && is_write) {
      const cmd = String(params.command || "").toLowerCase();
      const is_dangerous = tool_name === "exec" && DANGEROUS_COMMANDS.some((d) => cmd.includes(d));
      if (is_dangerous) {
        return { permission: "deny", reason: `dangerous command blocked: ${cmd.slice(0, 50)}` };
      }
      return { permission: "ask", reason: `trusted-only: ${tool_name} requires approval` };
    }

    return { permission: "allow" };
  };
}

export {
  ToolRegistry,
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  ListDirTool,
  SearchFilesTool,
  ExecTool,
  WebSearchTool,
  WebFetchTool,
  WebBrowserTool,
  WebSnapshotTool,
  WebExtractTool,
  WebPdfTool,
  WebMonitorTool,
  DiagramRenderTool,
  AskUserTool,
  MessageTool,
  FileRequestTool,
  SendFileTool,
  SpawnTool,
  ChainTool,
  CronTool,
  MemoryTool,
  DecisionTool,
  SecretTool,
  PromiseTool,
  DateTimeTool,
  HttpRequestTool,
  OAuthFetchTool,
  TaskQueryTool,
  WorkflowTool,
  KanbanTool,
  DynamicToolRuntimeLoader,
  ToolRuntimeReloader,
  ToolInstallerService,
  SqliteDynamicToolStore,
  FileMcpServerStore,
  ToolSelfTestService,
  RuntimeAdminTool,
  GitTool,
  ArchiveTool,
  ProcessManagerTool,
  NotificationTool,
  DockerTool,
  WebTableTool,
  NetworkTool,
  WebFormTool,
  SystemInfoTool,
  PkgManagerTool,
  WebAuthTool,
  CronShellTool,
  DataFormatTool,
  EncodingTool,
  RegexTool,
  DiffTool,
  ScreenshotTool,
  DatabaseTool,
  TemplateTool,
  ValidatorTool,
  QueueTool,
  CacheTool,
  ImageTool,
  StatsTool,
  TextTool,
  CompressTool,
  MathTool,
  TableTool,
  EvalTool,
  FormatTool,
  SetTool,
  LookupTool,
  MarkdownTool,
  TextSplitterTool,
  RetrieverTool,
  AggregateTool,
  AssertTool,
  MediaTool,
  CsvTool,
  WebSocketTool,
  PdfTool,
  RateLimitTool,
  XmlTool,
  YamlTool,
  FtpTool,
  DnsTool,
  SemverTool,
  UuidTool,
  SshTool,
  S3Tool,
  EnvTool,
  HtmlTool,
  JsonPatchTool,
  TomlTool,
  JsonlTool,
  RandomTool,
  ColorTool,
  QrTool,
  GeoTool,
  MqttTool,
  RedisTool,
  HttpMockTool,
  UrlTool,
  IpTool,
  SqlBuilderTool,
  LogParserTool,
  IniTool,
  RssTool,
  DotenvTool,
  IcalTool,
  BaseConvertTool,
  SlugTool,
  DurationTool,
  LdapTool,
  SyslogTool,
  PrometheusTool,
  JsonSchemaTool,
  OpenApiTool,
  MimeTool,
  UserAgentTool,
  BarcodeTool,
  VcardTool,
  SitemapTool,
  RobotsTxtTool,
  PhoneTool,
  EmailValidateTool,
  CountryTool,
  UnitConvertTool,
  HealthcheckTool,
  WhoisTool,
  AsciiArtTool,
  CookieTool,
  CorsTool,
  CspTool,
  PasswordTool,
  ChangelogTool,
  LicenseTool,
  GlobMatchTool,
  DependencyTool,
  MatrixTool,
  TimeseriesTool,
  CurrencyTool,
  TimezoneTool,
  MsgpackTool,
  StateMachineTool,
  ProtobufTool,
  CodeDiagramTool,
  GraphTool,
  TreeTool,
  BloomFilterTool,
  TokenizerTool,
  SentimentTool,
  SimilarityTool,
  CircuitBreakerTool,
  MetricTool,
  FeatureFlagTool,
  DataMaskTool,
  ChecksumTool,
  HttpHeaderTool,
  PaginationTool,
  CrontabTool,
  SvgTool,
};
export { Tool } from "./base.js";
export type {
  JsonSchema,
  ToolSchema,
  ToolLike,
  ToolCategory,
  ToolPolicyFlags,
  ToolExecuteResult,
  ToolExecutionContext,
  ToolHookDecision,
  PreToolHook,
  PostToolHook,
} from "./types.js";
export type { DynamicToolManifestEntry } from "./dynamic.js";
export type { InstallShellToolInput } from "./installer.js";
export type { DynamicToolStoreLike } from "./store.js";
export type { McpServerStoreLike, McpServerEntry } from "./mcp-store.js";
export type { TaskQueryResult, TaskQueryCallback } from "./task-query.js";
export { execute_chain, type ChainStep, type ChainResult } from "./chain.js";
export { PolicyTool, type PolicyStoreLike } from "./policy-tool.js";
export { validate_url, normalize_headers, serialize_body, format_response, timed_fetch, type HttpResponseSummary } from "./http-utils.js";

/** create_default_tool_registry 옵션. */
export type ToolRegistryFactoryOptions = {
  workspace?: string;
  allowed_dir?: string | null;
  dynamic_store_path?: string;
  dynamic_store?: DynamicToolStoreLike;
  cron?: CronScheduler | null;
  bus?: MessageBusLike | null;
  spawn_callback?: ((request: SpawnRequest) => Promise<{ subagent_id: string; status: string; message?: string }>) | null;
  task_query_callback?: TaskQueryCallback | null;
  event_recorder?: ((event: AppendWorkflowEventInput) => Promise<AppendWorkflowEventResult>) | null;
  refresh_skills?: () => void;
  runtime_policy?: RuntimeExecutionPolicy;
  pre_hooks?: PreToolHook[];
  post_hooks?: PostToolHook[];
};

/** 팩토리 반환 번들 — 호출자가 내부 서비스를 재사용할 수 있도록 노출. */
export type ToolRegistryBundle = {
  registry: ToolRegistry;
  installer: ToolInstallerService;
  dynamic_loader: DynamicToolRuntimeLoader;
};

export function create_default_tool_registry(args?: ToolRegistryFactoryOptions): ToolRegistryBundle {
  const pre_hooks: PreToolHook[] = [...(args?.pre_hooks || [])];
  const registry = new ToolRegistry({
    pre_hooks,
    post_hooks: args?.post_hooks || [],
    on_approval_request: args?.bus
      ? build_approval_notifier({ bus: args.bus, event_recorder: args.event_recorder })
      : undefined,
  });
  if (args?.runtime_policy) {
    pre_hooks.unshift(create_policy_pre_hook(args.runtime_policy, registry));
  }
  const workspace = args?.workspace || process.cwd();
  const allowed_dir = args?.allowed_dir ?? workspace;
  let sender: ((message: OutboundMessage) => Promise<void>) | null = null;

  registry.register(new ReadFileTool({ workspace, allowed_dir }));
  registry.register(new WriteFileTool({ workspace, allowed_dir }));
  registry.register(new EditFileTool({ workspace, allowed_dir }));
  registry.register(new ListDirTool({ workspace, allowed_dir }));
  registry.register(new SearchFilesTool({ workspace, allowed_dir }));
  registry.register(new ExecTool({ working_dir: workspace, restrict_to_working_dir: true }));
  registry.register(new WebSearchTool());
  registry.register(new WebFetchTool());
  registry.register(new WebBrowserTool());
  registry.register(new WebSnapshotTool({ workspace }));
  registry.register(new WebExtractTool());
  registry.register(new WebPdfTool({ workspace }));
  registry.register(new WebMonitorTool({ workspace }));
  registry.register(new DiagramRenderTool());
  registry.register(new DateTimeTool());
  registry.register(new HttpRequestTool());
  registry.register(new ChainTool(registry));
  registry.register(new GitTool({ workspace }));
  registry.register(new ArchiveTool({ workspace }));
  registry.register(new ProcessManagerTool({ workspace }));
  registry.register(new NotificationTool());
  registry.register(new DockerTool({ workspace }));
  registry.register(new WebTableTool());
  registry.register(new NetworkTool({ workspace }));
  registry.register(new WebFormTool());
  registry.register(new SystemInfoTool({ workspace }));
  registry.register(new PkgManagerTool({ workspace }));
  registry.register(new WebAuthTool());
  registry.register(new CronShellTool({ workspace }));
  registry.register(new DataFormatTool());
  registry.register(new EncodingTool());
  registry.register(new RegexTool());
  registry.register(new DiffTool());
  registry.register(new ScreenshotTool({ workspace }));
  registry.register(new DatabaseTool({ workspace }));
  registry.register(new TemplateTool());
  registry.register(new ValidatorTool());
  registry.register(new QueueTool());
  registry.register(new CacheTool());
  registry.register(new ImageTool({ workspace }));
  registry.register(new StatsTool());
  registry.register(new TextTool());
  registry.register(new CompressTool());
  registry.register(new MathTool());
  registry.register(new TableTool());
  registry.register(new EvalTool());
  registry.register(new FormatTool());
  registry.register(new SetTool());
  registry.register(new LookupTool());
  registry.register(new MarkdownTool());
  registry.register(new WebhookTool());
  registry.register(new EmailTool());
  registry.register(new GraphqlTool());
  registry.register(new JwtTool());
  registry.register(new TransformTool());
  registry.register(new FilterTool());
  registry.register(new CryptoTool());
  registry.register(new HashTool());
  registry.register(new VectorStoreTool());
  registry.register(new EmbeddingTool());
  registry.register(new TextSplitterTool());
  registry.register(new RetrieverTool());
  registry.register(new AggregateTool());
  registry.register(new AssertTool());
  registry.register(new MediaTool({ workspace }));
  registry.register(new CsvTool());
  registry.register(new WebSocketTool());
  registry.register(new PdfTool({ workspace }));
  registry.register(new RateLimitTool());
  registry.register(new XmlTool());
  registry.register(new YamlTool());
  registry.register(new FtpTool());
  registry.register(new DnsTool());
  registry.register(new SemverTool());
  registry.register(new UuidTool());
  registry.register(new SshTool());
  registry.register(new S3Tool());
  registry.register(new EnvTool());
  registry.register(new HtmlTool());
  registry.register(new JsonPatchTool());
  registry.register(new TomlTool());
  registry.register(new JsonlTool());
  registry.register(new RandomTool());
  registry.register(new ColorTool());
  registry.register(new QrTool());
  registry.register(new GeoTool());
  registry.register(new MqttTool());
  registry.register(new RedisTool());
  registry.register(new HttpMockTool());
  registry.register(new UrlTool());
  registry.register(new IpTool());
  registry.register(new SqlBuilderTool());
  registry.register(new LogParserTool());
  registry.register(new IniTool());
  registry.register(new RssTool());
  registry.register(new DotenvTool());
  registry.register(new IcalTool());
  registry.register(new BaseConvertTool());
  registry.register(new SlugTool());
  registry.register(new DurationTool());
  registry.register(new LdapTool());
  registry.register(new SyslogTool());
  registry.register(new PrometheusTool());
  registry.register(new JsonSchemaTool());
  registry.register(new OpenApiTool());
  registry.register(new MimeTool());
  registry.register(new UserAgentTool());
  registry.register(new BarcodeTool());
  registry.register(new VcardTool());
  registry.register(new SitemapTool());
  registry.register(new RobotsTxtTool());
  registry.register(new PhoneTool());
  registry.register(new EmailValidateTool());
  registry.register(new CountryTool());
  registry.register(new UnitConvertTool());
  registry.register(new HealthcheckTool());
  registry.register(new WhoisTool());
  registry.register(new AsciiArtTool());
  registry.register(new CookieTool());
  registry.register(new CorsTool());
  registry.register(new CspTool());
  registry.register(new PasswordTool());
  registry.register(new ChangelogTool());
  registry.register(new LicenseTool());
  registry.register(new GlobMatchTool());
  registry.register(new DependencyTool());
  registry.register(new MatrixTool());
  registry.register(new TimeseriesTool());
  registry.register(new CurrencyTool());
  registry.register(new TimezoneTool());
  registry.register(new MsgpackTool());
  registry.register(new StateMachineTool());
  registry.register(new ProtobufTool());
  registry.register(new CodeDiagramTool());
  registry.register(new GraphTool());
  registry.register(new TreeTool());
  registry.register(new BloomFilterTool());
  registry.register(new TokenizerTool());
  registry.register(new SentimentTool());
  registry.register(new SimilarityTool());
  registry.register(new CircuitBreakerTool());
  registry.register(new MetricTool());
  registry.register(new FeatureFlagTool());
  registry.register(new DataMaskTool());
  registry.register(new ChecksumTool());
  registry.register(new HttpHeaderTool());
  registry.register(new PaginationTool());
  registry.register(new CrontabTool());
  registry.register(new SvgTool());

  if (args?.task_query_callback) {
    registry.register(new TaskQueryTool(args.task_query_callback));
  }
  if (args?.bus) {
    sender = async (message: OutboundMessage): Promise<void> => {
      await args.bus?.publish_outbound(message);
    };
    registry.register(new MessageTool({
      send_callback: sender,
      event_recorder: args?.event_recorder || null,
      workspace,
    }));
    registry.register(new AskUserTool({ send_callback: sender }));
    registry.register(new FileRequestTool({ send_callback: sender }));
    registry.register(new SendFileTool({ send_callback: sender, workspace }));
  }
  if (args?.spawn_callback) {
    registry.register(new SpawnTool(args.spawn_callback));
  }
  if (args?.cron) {
    registry.register(new CronTool(args.cron));
  }

  const dynamic_store_path = args?.dynamic_store_path;
  const dynamic_store = args?.dynamic_store || new SqliteDynamicToolStore(workspace, dynamic_store_path);
  const dynamic_loader = new DynamicToolRuntimeLoader(workspace, dynamic_store_path, dynamic_store);
  registry.set_dynamic_tools(dynamic_loader.load_tools());
  const installer = new ToolInstallerService(workspace, dynamic_store_path, dynamic_store);
  registry.register(new RuntimeAdminTool({
    workspace,
    installer,
    list_registered_tool_names: () => registry.tool_names(),
    refresh_skills: args?.refresh_skills || undefined,
    refresh_dynamic_tools: () => {
      const tools = dynamic_loader.load_tools();
      registry.set_dynamic_tools(tools);
      return tools.length;
    },
  }));

  return { registry, installer, dynamic_loader };
}
