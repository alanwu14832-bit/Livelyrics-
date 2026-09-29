import { describe, expect, it } from "vitest";
import { AUTO_LYRIC_STYLE_IDS, SCENE_IDS, TYPE_RECIPE_IDS, TYPE_VOICE_IDS } from "@/lib/schema";
import { designPlanJsonSchema, designPlanOutputFormat } from "./output-schema";

type Node = Record<string, unknown>;

function walk(node: unknown, visit: (n: Node, path: string) => void, path = "$") {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((n, i) => walk(n, visit, `${path}[${i}]`));
    return;
  }
  const n = node as Node;
  visit(n, path);
  for (const [k, v] of Object.entries(n)) {
    if (k === "properties" && v && typeof v === "object") for (const [pk, pv] of Object.entries(v)) walk(pv, visit, `${path}.${pk}`);
    else if (k === "items" || k === "anyOf") walk(v, visit, `${path}.${k}`);
  }
}

describe("DesignPlan output schema", () => {
  const schema = designPlanJsonSchema();
  const props = schema.properties as Record<string, Node>;

  it("is strict: every object closed with all properties required", () => {
    walk(schema, (n, path) => {
      if (n.type === "object") {
        expect(n.additionalProperties, path).toBe(false);
        expect([...(n.required as string[])].sort(), path).toEqual(Object.keys(n.properties as object).sort());
      }
      expect(n.$schema, path).toBeUndefined();
    });
  });

  it("keeps the closed vocabularies as real enums", () => {
    const section = ((props.sections as Node).items as Node).properties as Record<string, Node>;
    expect(section.scene.enum).toEqual([...SCENE_IDS]);
    // karaoke and subtitle are not offered to the designer (字體藝術)
    expect(section.lyricStyle.enum).toEqual([...AUTO_LYRIC_STYLE_IDS]);
    expect(section.lyricStyle.enum).not.toContain("karaoke");
    expect(section.lyricStyle.enum).not.toContain("subtitle");
    expect(section.transitionIn.enum).toEqual(["cut", "fade", "flash", "wipe", "bloom"]);
    expect(props.version.enum).toEqual([1]);
    const line = ((props.lines as Node).items as Node).properties as Record<string, Node>;
    const variants = line.styleOverride.anyOf as Node[];
    expect(variants.map((v) => v.type)).toEqual(["string", "null"]);
    expect(variants[0].enum).toEqual([...AUTO_LYRIC_STYLE_IDS]);
  });

  it("asks for the type system with a composition per line (字體藝術)", () => {
    const ts = props.typeSystem as Node;
    expect(ts.type).toBe("object");
    const tp = ts.properties as Record<string, Node>;
    expect(tp.voice.enum).toEqual([...TYPE_VOICE_IDS]);
    const line = (tp.lines.items as Node).properties as Record<string, Node>;
    expect(Object.keys(line).sort()).toEqual(["emphasis", "energy", "lineId", "motionWord", "orientation", "recipe", "seed"]);
    expect(line.recipe.enum).toEqual([...TYPE_RECIPE_IDS]);
    expect(line.orientation.enum).toEqual(["h", "v", "mixed"]);
    // the editor-only fields are not part of what a designer writes
    expect(line.locked).toBeUndefined();
    expect(tp.sections).toBeUndefined();
  });

  it("keeps descriptions as guidance", () => {
    const kv = (props.keyVisual as Node).properties as Record<string, Node>;
    expect(String(kv.motifSvg.description)).toContain("currentColor");
  });

  it("is a json_schema output format", () => {
    const f = designPlanOutputFormat();
    expect(f.type).toBe("json_schema");
    expect(JSON.stringify(f.schema).length).toBeLessThan(20_000);
  });
});
