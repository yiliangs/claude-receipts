interface CurrentConfigShape {
  version?: string;
  dataRoot?: string;
}

interface LegacyConfigShape {
  receiptsRoot?: string;
}

export function validateCurrentConfig(
  value: unknown,
  path: string,
): CurrentConfigShape {
  const config = requirePlainObject(value, path);
  validateOptionalString(config, "version", path, false);
  const dataRoot = validateOptionalString(config, "dataRoot", path, true);
  return dataRoot ? { dataRoot } : {};
}

export function validateLegacyConfig(
  value: unknown,
  path: string,
): LegacyConfigShape {
  const config = requirePlainObject(value, path);
  const receiptsRoot = validateOptionalString(
    config,
    "receiptsRoot",
    path,
    true,
  );
  return receiptsRoot ? { receiptsRoot } : {};
}

function requirePlainObject(
  value: unknown,
  path: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidConfig(path, "expected a JSON object");
  }
  return value as Record<string, unknown>;
}

function validateOptionalString(
  config: Record<string, unknown>,
  key: string,
  path: string,
  requireNonempty: boolean,
): string | undefined {
  if (!(key in config)) return undefined;
  const value = config[key];
  if (typeof value !== "string") {
    throw invalidConfig(path, `${key} must be a string`);
  }
  const trimmed = value.trim();
  if (requireNonempty && !trimmed) {
    throw invalidConfig(path, `${key} must not be empty`);
  }
  return trimmed;
}

function invalidConfig(path: string, detail: string): Error {
  return new Error(`Failed to parse usage config ${path}: ${detail}`);
}
