/**
 * The small expression language a saved item's rows use to turn its settings
 * into numbers and words — `ceil(width * height / 144)`, `style == "french"`.
 *
 * Parsed by hand rather than handed to `eval` or `new Function`: a formula is
 * stored data, and a stored formula must never be able to run code.
 *
 * What it understands:
 *
 * - numbers (`36`, `1.5`), strings in single or double quotes, `true`, `false`
 * - setting keys as names (`width`, `wall_height`)
 * - `+ - * / %`, comparisons `== != < <= > >=`, `&& || !` (also `and or not`)
 * - `a ? b : c`
 * - `ceil floor round min max abs sqrt`; `round(x, 2)` rounds to two places
 *
 * `+` on two strings joins them; every other operator wants numbers.
 */

export type FormulaValue = number | string | boolean;

export class FormulaError extends Error {}

type Node =
  | { kind: "literal"; value: FormulaValue }
  | { kind: "name"; name: string }
  | { kind: "unary"; op: "-" | "!"; arg: Node }
  | { kind: "binary"; op: BinaryOp; left: Node; right: Node }
  | { kind: "ternary"; test: Node; then: Node; otherwise: Node }
  | { kind: "call"; fn: string; args: Node[] };

type BinaryOp =
  | "+" | "-" | "*" | "/" | "%"
  | "==" | "!=" | "<" | "<=" | ">" | ">="
  | "&&" | "||";

export type Formula = { source: string; ast: Node };

/* ── Tokens ───────────────────────────────────────────────────────────── */

type Token =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "name"; value: string }
  | { type: "op"; value: string }
  | { type: "end" };

const OPERATORS = [
  "==", "!=", "<=", ">=", "&&", "||",
  "+", "-", "*", "/", "%", "<", ">", "!", "?", ":", "(", ")", ",",
];

const WORD_OPERATORS: Record<string, string> = { and: "&&", or: "||", not: "!" };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;

  while (at < source.length) {
    const char = source[at];

    if (/\s/.test(char)) {
      at += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      const match = /^(\d+\.?\d*|\.\d+)/.exec(source.slice(at));
      if (!match) throw new FormulaError(`"${char}" isn't a number.`);
      tokens.push({ type: "number", value: Number(match[0]) });
      at += match[0].length;
      continue;
    }

    if (char === '"' || char === "'") {
      const end = source.indexOf(char, at + 1);
      if (end === -1) throw new FormulaError("A quote is never closed.");
      tokens.push({ type: "string", value: source.slice(at + 1, end) });
      at = end + 1;
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(at))!;
      const word = match[0];
      if (word in WORD_OPERATORS) {
        tokens.push({ type: "op", value: WORD_OPERATORS[word] });
      } else {
        tokens.push({ type: "name", value: word });
      }
      at += word.length;
      continue;
    }

    const op = OPERATORS.find((candidate) => source.startsWith(candidate, at));
    if (!op) throw new FormulaError(`"${char}" isn't something a formula can use.`);
    tokens.push({ type: "op", value: op });
    at += op.length;
  }

  tokens.push({ type: "end" });
  return tokens;
}

/* ── Parsing ──────────────────────────────────────────────────────────── */

const FUNCTIONS: Record<string, { min: number; max: number }> = {
  ceil: { min: 1, max: 1 },
  floor: { min: 1, max: 1 },
  round: { min: 1, max: 2 },
  abs: { min: 1, max: 1 },
  sqrt: { min: 1, max: 1 },
  min: { min: 1, max: 20 },
  max: { min: 1, max: 20 },
};

export function parseFormula(source: string): Formula {
  const tokens = tokenize(source);
  let at = 0;

  const peek = () => tokens[at];
  const isOp = (value: string) => {
    const token = peek();
    return token.type === "op" && token.value === value;
  };
  const expect = (value: string) => {
    if (!isOp(value)) throw new FormulaError(`Expected "${value}".`);
    at += 1;
  };

  function expression(): Node {
    const test = or();
    if (!isOp("?")) return test;
    at += 1;
    const then = expression();
    expect(":");
    const otherwise = expression();
    return { kind: "ternary", test, then, otherwise };
  }

  function binaryLevel(ops: BinaryOp[], next: () => Node): () => Node {
    return () => {
      let left = next();
      for (;;) {
        const token = peek();
        if (token.type !== "op" || !ops.includes(token.value as BinaryOp)) {
          return left;
        }
        at += 1;
        left = { kind: "binary", op: token.value as BinaryOp, left, right: next() };
      }
    };
  }

  function unary(): Node {
    if (isOp("-") || isOp("!")) {
      const op = (peek() as { value: "-" | "!" }).value;
      at += 1;
      return { kind: "unary", op, arg: unary() };
    }
    return primary();
  }

  function primary(): Node {
    const token = peek();

    if (token.type === "number" || token.type === "string") {
      at += 1;
      return { kind: "literal", value: token.value };
    }

    if (token.type === "name") {
      at += 1;
      if (token.value === "true" || token.value === "false") {
        return { kind: "literal", value: token.value === "true" };
      }
      if (!isOp("(")) return { kind: "name", name: token.value };

      const rule = FUNCTIONS[token.value];
      if (!rule) throw new FormulaError(`"${token.value}" isn't a function a formula can call.`);
      at += 1;
      const args: Node[] = [];
      if (!isOp(")")) {
        args.push(expression());
        while (isOp(",")) {
          at += 1;
          args.push(expression());
        }
      }
      expect(")");
      if (args.length < rule.min || args.length > rule.max) {
        throw new FormulaError(`${token.value}() takes ${rule.min === rule.max ? rule.min : `${rule.min} to ${rule.max}`} value${rule.max === 1 ? "" : "s"}.`);
      }
      return { kind: "call", fn: token.value, args };
    }

    if (isOp("(")) {
      at += 1;
      const inner = expression();
      expect(")");
      return inner;
    }

    throw new FormulaError(token.type === "end" ? "The formula ends too early." : "The formula has something out of place.");
  }

  const multiplicative = binaryLevel(["*", "/", "%"], unary);
  const additive = binaryLevel(["+", "-"], multiplicative);
  const comparison = binaryLevel(["==", "!=", "<", "<=", ">", ">="], additive);
  const and = binaryLevel(["&&"], comparison);
  const or = binaryLevel(["||"], and);

  if (!source.trim()) throw new FormulaError("The formula is empty.");
  const ast = expression();
  if (peek().type !== "end") throw new FormulaError("The formula has something extra at the end.");
  return { source, ast };
}

/** Every setting a formula reads, so a save can refuse one that names a setting the item doesn't have. */
export function formulaNames(formula: Formula): string[] {
  const names = new Set<string>();
  function visit(node: Node) {
    switch (node.kind) {
      case "name":
        names.add(node.name);
        break;
      case "unary":
        visit(node.arg);
        break;
      case "binary":
        visit(node.left);
        visit(node.right);
        break;
      case "ternary":
        visit(node.test);
        visit(node.then);
        visit(node.otherwise);
        break;
      case "call":
        node.args.forEach(visit);
        break;
    }
  }
  visit(formula.ast);
  return [...names];
}

/* ── Evaluating ───────────────────────────────────────────────────────── */

function number(value: FormulaValue, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new FormulaError(`${what} needs a number.`);
  }
  return value;
}

function truthy(value: FormulaValue): boolean {
  return typeof value === "string" ? value !== "" : Boolean(value);
}

export function evaluateFormula(
  formula: Formula,
  scope: Record<string, FormulaValue>
): FormulaValue {
  function run(node: Node): FormulaValue {
    switch (node.kind) {
      case "literal":
        return node.value;

      case "name": {
        if (!(node.name in scope)) throw new FormulaError(`There's no setting called "${node.name}".`);
        return scope[node.name];
      }

      case "unary": {
        const value = run(node.arg);
        return node.op === "!" ? !truthy(value) : -number(value, "A minus sign");
      }

      case "ternary":
        return truthy(run(node.test)) ? run(node.then) : run(node.otherwise);

      case "call": {
        const args = node.args.map(run);
        const nums = () => args.map((arg) => number(arg, `${node.fn}()`));
        switch (node.fn) {
          case "ceil": return Math.ceil(nums()[0]);
          case "floor": return Math.floor(nums()[0]);
          case "abs": return Math.abs(nums()[0]);
          case "sqrt": return Math.sqrt(nums()[0]);
          case "min": return Math.min(...nums());
          case "max": return Math.max(...nums());
          case "round": {
            const [value, places = 0] = nums();
            const factor = 10 ** Math.max(0, Math.min(6, Math.trunc(places)));
            return Math.round(value * factor) / factor;
          }
        }
        throw new FormulaError(`"${node.fn}" isn't a function a formula can call.`);
      }

      case "binary": {
        if (node.op === "&&") return truthy(run(node.left)) && truthy(run(node.right));
        if (node.op === "||") return truthy(run(node.left)) || truthy(run(node.right));

        const left = run(node.left);
        const right = run(node.right);

        switch (node.op) {
          case "==": return left === right;
          case "!=": return left !== right;
          case "+":
            if (typeof left === "string" && typeof right === "string") return left + right;
            return number(left, "+") + number(right, "+");
          case "-": return number(left, "-") - number(right, "-");
          case "*": return number(left, "*") * number(right, "*");
          case "/": {
            const divisor = number(right, "/");
            if (divisor === 0) throw new FormulaError("The formula divides by zero.");
            return number(left, "/") / divisor;
          }
          case "%": {
            const divisor = number(right, "%");
            if (divisor === 0) throw new FormulaError("The formula divides by zero.");
            return number(left, "%") % divisor;
          }
          case "<": return number(left, "<") < number(right, "<");
          case "<=": return number(left, "<=") <= number(right, "<=");
          case ">": return number(left, ">") > number(right, ">");
          case ">=": return number(left, ">=") >= number(right, ">=");
        }
        throw new FormulaError(`"${node.op}" isn't an operator a formula can use.`);
      }
    }
  }

  return run(formula.ast);
}

export function formulaNumber(
  formula: Formula,
  scope: Record<string, FormulaValue>
): number {
  return number(evaluateFormula(formula, scope), "This formula");
}

export function formulaTruthy(
  formula: Formula,
  scope: Record<string, FormulaValue>
): boolean {
  return truthy(evaluateFormula(formula, scope));
}

/**
 * Fills `{…}` in a sentence from the settings — `Window {width} × {height}`.
 * Each brace holds a formula, so `{width * 2}` works too. Numbers print without
 * trailing zeros.
 */
export function fillTemplate(
  template: string,
  scope: Record<string, FormulaValue>
): string {
  return template.replace(/\{([^{}]+)\}/g, (_, source: string) => {
    const value = evaluateFormula(parseFormula(source), scope);
    if (typeof value === "number") return String(Math.round(value * 1000) / 1000);
    return String(value);
  });
}

/** The formulas inside a sentence's braces, for checking them on save. */
export function templateFormulas(template: string): Formula[] {
  return [...template.matchAll(/\{([^{}]+)\}/g)].map((match) => parseFormula(match[1]));
}
