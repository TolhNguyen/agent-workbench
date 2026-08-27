import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A deliberately small JSON Schema checker covering exactly the keywords used by
// schemas/*.json. It exists so those contracts are enforced rather than being
// documentation that silently drifts from the code -- the reason a broken escape
// sequence sat unnoticed in artifact.schema.json.
const SCHEMA_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "schemas");
const cache = new Map();

export async function loadSchema(name) {
  if (!cache.has(name)) {
    const target = path.join(SCHEMA_DIRECTORY, `${name}.schema.json`);
    let parsed;
    try {
      parsed = JSON.parse(await readFile(target, "utf8"));
    } catch (error) {
      throw new Error(`Invalid schema ${name}.schema.json: ${error.message}`);
    }
    cache.set(name, parsed);
  }
  return cache.get(name);
}

export async function loadSchemas(names) {
  const loaded = await Promise.all(names.map((name) => loadSchema(name)));
  return Object.fromEntries(names.map((name, index) => [name, loaded[index]]));
}

export function validateAgainstSchema(value, schema, label = "value") {
  const errors = [];
  check(value, schema, label, errors);
  return errors;
}

function check(value, schema, at, errors) {
  if (!schema || typeof schema !== "object") return;

  if ("const" in schema && !equals(value, schema.const)) {
    errors.push(`${at} must equal ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => equals(option, value))) {
    errors.push(`${at} must be one of ${schema.enum.map((option) => JSON.stringify(option)).join(", ")}`);
  }
  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    errors.push(`${at} must be of type ${[schema.type].flat().join(" or ")}`);
    return; // Every remaining keyword assumes the type already matched.
  }
  // Checked after the type: a value of the wrong type vacuously satisfies a
  // string-only constraint such as `pattern`, which would report `not` as
  // violated on top of the real error.
  if (schema.not && matchesSchema(value, schema.not)) {
    errors.push(`${at} must not match the forbidden shape`);
  }

  if (typeof value === "string") {
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${at} must match ${schema.pattern}`);
    }
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) {
      errors.push(`${at} must be at least ${schema.minLength} character(s) long`);
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`${at} must be greater than or equal to ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(`${at} must be less than or equal to ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
      errors.push(`${at} must contain at least ${schema.minItems} item(s)`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Set(value.map((item) => JSON.stringify(item)));
      if (seen.size !== value.length) errors.push(`${at} must not contain duplicate items`);
    }
    if (schema.items) {
      value.forEach((item, index) => check(item, schema.items, `${at}[${index}]`, errors));
    }
  }

  if (isPlainObject(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${at} is missing required property: ${key}`);
    }
    for (const [key, subSchema] of Object.entries(schema.properties ?? {})) {
      if (key in value) check(value[key], subSchema, `${at}.${key}`, errors);
    }
    if (schema.additionalProperties === false) {
      const declared = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value)) {
        if (!declared.has(key)) errors.push(`${at} has an unexpected property: ${key}`);
      }
    }
  }
}

function matchesSchema(value, schema) {
  const nested = [];
  check(value, schema, "value", nested);
  return nested.length === 0;
}

function matchesType(value, type) {
  return [type].flat().some((name) => {
    if (name === "object") return isPlainObject(value);
    if (name === "array") return Array.isArray(value);
    if (name === "null") return value === null;
    if (name === "integer") return Number.isInteger(value);
    if (name === "number") return typeof value === "number" && Number.isFinite(value);
    if (name === "boolean") return typeof value === "boolean";
    if (name === "string") return typeof value === "string";
    return true;
  });
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function equals(a, b) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
