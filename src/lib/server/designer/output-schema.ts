// Structured-output JSON schema for DesignPlanSchema.
//
// The SDK helper (betaZodOutputFormat / zodOutputFormat) moves every keyword it does
// not know — including `enum` and `const` — into the description text, so the closed
// scene / lyric-style / font vocabularies would not be enforced by the API. We derive
// the schema with z.toJSONSchema instead and keep enums as real constraints, applying
// the same strictness rules as the SDK (every property required, no additional
// properties, unsupported keywords folded into the description). The response is
// parsed and validated with DesignPlanSchema.safeParse by the caller.

import { z } from "zod";
import type { BetaJSONOutputFormat } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { DesignPlanSchema } from "@/lib/schema";

type Json = Record<string, unknown>;

const PASSTHROUGH_STRING_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);

function isObj(x: unknown): x is Json {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function strict(node: unknown): Json {
  if (!isObj(node)) return {};
  const src: Json = { ...node };
  const out: Json = {};
  delete src.$schema;
  delete src.$id;

  const take = (k: string) => {
    const v = src[k];
    delete src[k];
    return v;
  };

  const anyOfRaw = take("anyOf");
  const oneOfRaw = take("oneOf");
  const anyOf = anyOfRaw ?? oneOfRaw;
  const type = take("type");
  if (Array.isArray(anyOf)) out.anyOf = anyOf.map(strict);
  else if (type !== undefined) out.type = type;

  const description = take("description");
  if (typeof description === "string") out.description = description;
  const title = take("title");
  if (typeof title === "string") out.title = title;

  const en = take("enum");
  if (Array.isArray(en)) out.enum = en;
  const cn = take("const");
  if (cn !== undefined) out.enum = [cn];

  if (type === "object") {
    const props = take("properties");
    const properties: Json = {};
    if (isObj(props)) for (const [k, v] of Object.entries(props)) properties[k] = strict(v);
    out.properties = properties;
    out.required = Object.keys(properties);
    out.additionalProperties = false;
    take("required");
    take("additionalProperties");
  } else if (type === "array") {
    const items = take("items");
    if (items !== undefined) out.items = strict(items);
    const minItems = take("minItems");
    if (minItems === 0 || minItems === 1) out.minItems = minItems;
    else if (minItems !== undefined) src.minItems = minItems;
  } else if (type === "string") {
    const format = take("format");
    if (typeof format === "string" && PASSTHROUGH_STRING_FORMATS.has(format)) out.format = format;
    else if (format !== undefined) src.format = format;
  }

  // anything left (minimum, maxItems, pattern, ...) is a hint only
  const rest = Object.entries(src);
  if (rest.length) {
    const hint = `{${rest.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")}}`;
    out.description = typeof out.description === "string" ? `${out.description}\n\n${hint}` : hint;
  }
  return out;
}

/** Strict structured-output JSON schema for any zod object (same rules as the DesignPlan schema). */
export function jsonOutputFormat(schema: z.ZodType): BetaJSONOutputFormat {
  return { type: "json_schema", schema: strict(z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "any" })) };
}

let cached: Json | null = null;

/** JSON schema of DesignPlan for output_config.format (enums enforced, all fields required). */
export function designPlanJsonSchema(): Json {
  if (!cached) cached = strict(z.toJSONSchema(DesignPlanSchema, { target: "draft-2020-12", unrepresentable: "any" }));
  return structuredClone(cached);
}

export function designPlanOutputFormat(): BetaJSONOutputFormat {
  return { type: "json_schema", schema: designPlanJsonSchema() };
}
