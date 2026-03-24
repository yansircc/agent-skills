import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const RUNTIME_CONFIG_ENV = "CLAUDE_DELEGATE_RUNTIME_CONFIG";
export const RUNTIME_ENV = "CLAUDE_DELEGATE_RUNTIME";
export const RUNTIME_BIN_ENV = "CLAUDE_DELEGATE_RUNTIME_BIN";
export const LEGACY_CCC_BIN_ENV = "CCC_BIN";

const ENV_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

const DEFAULT_RUNTIME_CONFIG: Record<string, unknown> = {
  default_runtime: "claude",
  runtimes: {
    claude: {
      bin: "claude",
      args: [],
      supports_native_provider: false,
      supports_settings: true,
    },
    ccc: {
      bin: "ccc",
      args: [],
      supports_native_provider: true,
      supports_settings: true,
    },
  },
  providers: {},
};

function _deepMerge(base: unknown, override: unknown): unknown {
  if (
    base !== null &&
    typeof base === "object" &&
    !Array.isArray(base) &&
    override !== null &&
    typeof override === "object" &&
    !Array.isArray(override)
  ) {
    const merged = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(
      override as Record<string, unknown>,
    )) {
      merged[key] =
        key in merged
          ? _deepMerge(merged[key], value)
          : structuredClone(value);
    }
    return merged;
  }
  return structuredClone(override);
}

export function defaultRuntimeConfigPaths(): string[] {
  const home = homedir();
  return [
    path.join(home, ".codex", "claude-delegate", "runtime_profiles.json"),
    path.join(home, ".config", "claude-delegate", "runtime_profiles.json"),
  ];
}

function normalizeName(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function loadJsonFile(filePath: string): Record<string, unknown> {
  const payload = JSON.parse(readFileSync(filePath, "utf-8"));
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error(
      `Runtime config must decode to a JSON object: ${filePath}`,
    );
  }
  return payload as Record<string, unknown>;
}

export function loadRuntimeConfig(
  explicitPath: string | null = null,
): [Record<string, unknown>, string | null] {
  const config = structuredClone(DEFAULT_RUNTIME_CONFIG);

  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (!existsSync(resolved)) {
      throw new Error(`Runtime config path not found: ${resolved}`);
    }
    return [
      _deepMerge(config, loadJsonFile(resolved)) as Record<string, unknown>,
      resolved,
    ];
  }

  const envPath = process.env[RUNTIME_CONFIG_ENV];
  if (envPath) {
    const resolved = path.resolve(envPath);
    if (!existsSync(resolved)) {
      throw new Error(`Runtime config path not found: ${resolved}`);
    }
    return [
      _deepMerge(config, loadJsonFile(resolved)) as Record<string, unknown>,
      resolved,
    ];
  }

  for (const candidate of defaultRuntimeConfigPaths()) {
    if (existsSync(candidate)) {
      return [
        _deepMerge(config, loadJsonFile(candidate)) as Record<
          string,
          unknown
        >,
        candidate,
      ];
    }
  }

  return [config, null];
}

function normalizeArgs(value: unknown, label: string): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a JSON array of strings.`);
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error(`${label} must contain only strings.`);
    }
    if (item) result.push(item);
  }
  return result;
}

function providerEntry(
  config: Record<string, unknown>,
  providerName: string | null,
): Record<string, unknown> | null {
  if (providerName === null) return null;
  const providers = (config.providers ?? {}) as Record<string, unknown>;
  if (typeof providers !== "object" || providers === null || Array.isArray(providers)) {
    throw new Error("Runtime config 'providers' must be an object.");
  }
  const entry = providers[providerName];
  if (entry === undefined || entry === null) return null;
  if (typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(
      `Provider profile must be an object: ${providerName}`,
    );
  }
  return entry as Record<string, unknown>;
}

function runtimeEntry(
  config: Record<string, unknown>,
  runtimeName: string,
): Record<string, unknown> {
  const runtimes = (config.runtimes ?? {}) as Record<string, unknown>;
  if (typeof runtimes !== "object" || runtimes === null || Array.isArray(runtimes)) {
    throw new Error("Runtime config 'runtimes' must be an object.");
  }
  const entry = runtimes[runtimeName];
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new Error(`Unknown runtime profile: ${runtimeName}`);
  }
  return entry as Record<string, unknown>;
}

function referencedEnvVars(value: string): string[] {
  const names: string[] = [];
  const re = new RegExp(ENV_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    names.push(match[1] ?? match[2]);
  }
  return names;
}

function validateProcessEnvTemplates(
  processEnv: unknown,
  providerName: string,
): Record<string, string> {
  if (processEnv === null || processEnv === undefined) return {};
  if (
    typeof processEnv !== "object" ||
    Array.isArray(processEnv)
  ) {
    throw new Error(
      `Provider profile process_env must be an object: ${providerName}`,
    );
  }

  const normalized: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(
    processEnv as Record<string, unknown>,
  )) {
    if (typeof key !== "string" || !key) {
      throw new Error(
        `Provider profile process_env keys must be non-empty strings: ${providerName}`,
      );
    }
    if (typeof rawValue !== "string") {
      throw new Error(
        `Provider profile process_env values must be strings: ${providerName}`,
      );
    }
    for (const envName of referencedEnvVars(rawValue)) {
      if (!(envName in process.env)) {
        throw new Error(
          `Provider profile '${providerName}' requires env var '${envName}' for process_env expansion.`,
        );
      }
    }
    normalized[key] = rawValue;
  }
  return normalized;
}

function expandTemplate(value: string): string {
  const re = new RegExp(ENV_PATTERN.source, "g");
  return value.replace(re, (_match, g1: string | undefined, g2: string | undefined) => {
    const envName = g1 ?? g2!;
    const envValue = process.env[envName];
    if (envValue === undefined) {
      throw new Error(
        `Missing env var for runtime profile expansion: ${envName}`,
      );
    }
    return envValue;
  });
}

export function resolveRuntimeRequest(
  request: Record<string, unknown>,
): Record<string, unknown> {
  const [config, configPath] = loadRuntimeConfig(
    normalizeName(request.runtime_config),
  );
  const providerName = normalizeName(request.provider);
  const providerEntryObj = providerEntry(config, providerName);

  const explicitRuntime =
    normalizeName(request.runtime) ??
    normalizeName(process.env[RUNTIME_ENV]);
  const providerRuntime = normalizeName(
    (providerEntryObj ?? ({} as Record<string, unknown>)).runtime,
  );
  const defaultRuntime =
    normalizeName(config.default_runtime) ?? "claude";

  if (
    explicitRuntime &&
    providerRuntime &&
    explicitRuntime !== providerRuntime
  ) {
    throw new Error(
      `Provider profile '${providerName}' requires runtime '${providerRuntime}', ` +
        `but request selected runtime '${explicitRuntime}'.`,
    );
  }

  const runtimeName = explicitRuntime ?? providerRuntime ?? defaultRuntime;
  const runtimeEntryObj = runtimeEntry(config, runtimeName);
  const runtimeArgs = normalizeArgs(
    runtimeEntryObj.args,
    `Runtime profile args for ${runtimeName}`,
  );
  const runtimeBin =
    normalizeName(request.runtime_bin) ??
    normalizeName(request.ccc_bin) ??
    normalizeName(process.env[RUNTIME_BIN_ENV]) ??
    normalizeName(process.env[LEGACY_CCC_BIN_ENV]) ??
    normalizeName(runtimeEntryObj.bin) ??
    runtimeName;
  const supportsNativeProvider = Boolean(
    runtimeEntryObj.supports_native_provider ?? false,
  );
  const supportsSettings = Boolean(
    runtimeEntryObj.supports_settings ?? true,
  );

  let providerSource = "none";
  let nativeProvider: string | null = null;
  let providerExtraArgs: string[] = [];
  let processEnvTemplates: Record<string, string> = {};

  if (providerName !== null) {
    if (providerEntryObj !== null) {
      nativeProvider = normalizeName(providerEntryObj.native_provider);
      providerExtraArgs = normalizeArgs(
        providerEntryObj.extra_args,
        `Provider profile extra_args for ${providerName}`,
      );
      processEnvTemplates = validateProcessEnvTemplates(
        providerEntryObj.process_env,
        providerName,
      );
      providerSource = "profile";
    } else if (supportsNativeProvider) {
      nativeProvider = providerName;
      providerSource = "native_runtime";
    } else {
      throw new Error(
        `Provider '${providerName}' is not configured for runtime '${runtimeName}'. ` +
          "Add a provider profile or choose a runtime that supports native provider routing.",
      );
    }

    if (nativeProvider !== null && !supportsNativeProvider) {
      throw new Error(
        `Runtime '${runtimeName}' does not support native provider routing, ` +
          `but provider '${providerName}' requests native_provider.`,
      );
    }
  }

  return {
    name: runtimeName,
    bin: runtimeBin,
    args: runtimeArgs,
    supports_native_provider: supportsNativeProvider,
    supports_settings: supportsSettings,
    config_path: configPath,
    provider_strategy: {
      name: providerName,
      source: providerSource,
      native_provider: nativeProvider,
      extra_args: providerExtraArgs,
      process_env_keys: Object.keys(processEnvTemplates).sort(),
    },
  };
}

export function buildProcessEnv(
  request: Record<string, unknown>,
): Record<string, string> {
  const runtimeResolution =
    (request.runtime_resolution as Record<string, unknown>) ?? {};
  const providerName = normalizeName(request.provider);
  const configPathVal = normalizeName(runtimeResolution.config_path);
  const [config] = loadRuntimeConfig(configPathVal);
  const providerEntryObj = providerEntry(config, providerName);
  const processEnvMap =
    providerEntryObj === null
      ? {}
      : validateProcessEnvTemplates(
          providerEntryObj.process_env,
          providerName ?? "",
        );

  const env: Record<string, string> = { ...process.env } as Record<
    string,
    string
  >;
  for (const [key, template] of Object.entries(processEnvMap)) {
    env[key] = expandTemplate(template);
  }
  return env;
}
