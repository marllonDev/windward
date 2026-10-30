// A small tokenizer for syntax colouring. It is not a parser: it only has to be fast,
// forgiving of half-typed code, and consistent with the design tokens.
export type Language = "sql" | "python" | "yaml" | "markdown" | "plain";
export type Token = { text: string; kind: string };

export const SQL_KEYWORDS = `select from where group by order having limit offset union all distinct as on join inner left right full outer cross
natural using with recursive insert into values update set delete merge create replace table view temporary temp database schema
catalog drop alter add column rename to if not exists and or in is null like rlike between case when then else end asc desc
nulls first last over partition rows range unbounded preceding following current row explain describe show tables databases
use cache uncache refresh analyze optimize vacuum truncate load data inpath overwrite local format options location comment
partitioned clustered buckets stored tblproperties external lateral pivot unpivot qualify tablesample interval cast try_cast
true false primary key foreign references default constraint index functions columns extended formatted extract grant revoke
minus intersect except exclude collate escape any some filter within`.split(/\s+/);

export const SQL_FUNCTIONS = `count sum avg min max abs round floor ceil ceiling sqrt power pow exp ln log log10 mod coalesce nullif ifnull nvl nvl2
concat concat_ws substring substr length upper lower trim ltrim rtrim lpad rpad replace regexp_replace regexp_extract split
array_contains explode posexplode collect_list collect_set size map_keys map_values struct named_struct array map element_at
date_add date_sub datediff date_format date_trunc current_date current_timestamp now to_date to_timestamp year month day
hour minute second dayofweek weekofyear unix_timestamp from_unixtime row_number rank dense_rank ntile lag lead first_value
last_value cume_dist percent_rank stddev variance corr approx_count_distinct percentile percentile_approx hash md5 sha1 sha2
crc32 greatest least if iff isnull isnotnull typeof from_json to_json get_json_object json_tuple range sequence shuffle
flatten transform aggregate exists forall zip_with array_sort sort_array array_distinct array_union array_intersect
array_except array_join array_max array_min slice reverse repeat translate initcap instr locate left right overlay`.split(/\s+/);

const SQL_TYPES = new Set(`int integer bigint smallint tinyint float double decimal numeric string varchar char text boolean bool
binary date timestamp timestamp_ntz interval array map struct void`.split(/\s+/));
const SQL_KW = new Set(SQL_KEYWORDS);
const SQL_FN = new Set(SQL_FUNCTIONS);

const PY_KEYWORDS = new Set(`False None True and as assert async await break class continue def del elif else except finally for from
global if import in is lambda nonlocal not or pass raise return try while with yield match case`.split(/\s+/));
const PY_BUILTINS = new Set(`print len range list dict set tuple str int float bool sum min max abs sorted enumerate zip map filter
open type isinstance super self cls spark display Exception ValueError KeyError`.split(/\s+/));

type Rule = [RegExp, string | ((m: string) => string)];

function run(src: string, rules: Rule[]): Token[] {
  const out: Token[] = [];
  let i = 0;
  let plain = "";
  const flush = () => {
    if (plain) out.push({ text: plain, kind: "" });
    plain = "";
  };
  while (i < src.length) {
    let hit = false;
    for (const [re, kind] of rules) {
      re.lastIndex = i;
      const m = re.exec(src);
      if (m && m.index === i && m[0].length > 0) {
        flush();
        out.push({ text: m[0], kind: typeof kind === "function" ? kind(m[0]) : kind });
        i += m[0].length;
        hit = true;
        break;
      }
    }
    if (!hit) {
      plain += src[i];
      i += 1;
    }
  }
  flush();
  return out;
}

const SQL_RULES: Rule[] = [
  [/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}/y, "jinja"],
  [/--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y, "com"],
  [/'(?:[^'\\]|\\.|'')*'?|"(?:[^"\\]|\\.)*"?/y, "str"],
  [/`[^`]*`?/y, "ident"],
  [/\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y, "num"],
  [/[A-Za-z_][A-Za-z0-9_]*(?=\s*\()/y, (w) => (SQL_KW.has(w.toLowerCase()) ? "kw" : "fn")],
  [/[A-Za-z_][A-Za-z0-9_]*/y, (w) => {
    const l = w.toLowerCase();
    return SQL_KW.has(l) ? "kw" : SQL_TYPES.has(l) ? "ty" : SQL_FN.has(l) ? "fn" : "";
  }],
  [/[=<>!+\-*/%|&^~]+/y, "op"],
];

const PY_RULES: Rule[] = [
  [/#[^\n]*/y, "com"],
  [/(?:[rbfRBF]{0,2})(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$))/y, "str"],
  [/(?:[rbfRBF]{0,2})(?:"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)/y, "str"],
  [/@[A-Za-z_][\w.]*/y, "fn"],
  [/\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y, "num"],
  [/[A-Za-z_]\w*(?=\s*\()/y, (w) => (PY_KEYWORDS.has(w) ? "kw" : PY_BUILTINS.has(w) ? "ty" : "fn")],
  [/[A-Za-z_]\w*/y, (w) => (PY_KEYWORDS.has(w) ? "kw" : PY_BUILTINS.has(w) ? "ty" : "")],
  [/[=<>!+\-*/%|&^~]+/y, "op"],
];

const YAML_RULES: Rule[] = [
  [/#[^\n]*/y, "com"],
  [/\{\{[\s\S]*?\}\}/y, "jinja"],
  [/'[^'\n]*'?|"[^"\n]*"?/y, "str"],
  [/^[ \t-]*[A-Za-z_][\w.-]*(?=\s*:)/my, "key"],
  [/\b\d+(?:\.\d+)?\b/y, "num"],
  [/\b(?:true|false|null|yes|no)\b/y, "kw"],
];

const MD_RULES: Rule[] = [
  [/^#{1,6}[^\n]*/my, "kw"],
  [/`[^`\n]+`/y, "str"],
  [/\*\*[^*\n]+\*\*/y, "fn"],
];

export function tokenize(src: string, language: Language): Token[] {
  switch (language) {
    case "sql": return run(src, SQL_RULES);
    case "python": return run(src, PY_RULES);
    case "yaml": return run(src, YAML_RULES);
    case "markdown": return run(src, MD_RULES);
    default: return [{ text: src, kind: "" }];
  }
}

/** Uppercase keywords and break before the major clauses. Good enough for a readable query. */
export function formatSql(src: string): string {
  const major = new Set(["select", "from", "where", "group", "order", "having", "limit", "union", "join", "left", "right", "inner", "full", "cross", "on", "with"]);
  const parts = tokenize(src, "sql").map((t) => {
    if (t.kind === "kw") {
      const w = t.text.toLowerCase();
      return major.has(w) && !/^(on)$/.test(w) ? `\n${t.text.toUpperCase()}` : t.text.toUpperCase();
    }
    return t.text;
  });
  return parts.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/^\n/, "").replace(/(\n)(LEFT|RIGHT|INNER|FULL|CROSS) \n?JOIN/g, "$1$2 JOIN");
}
