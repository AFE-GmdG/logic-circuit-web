import type TruthState from "../../types/simulation/truthState";

import i18n from "../../i18n";

import type CircuitTestSocket from "./circuitTestSocket";

type TokenKind =
  | "open"
  | "close"
  | "colon"
  | "comma"
  | "add"
  | "mul"
  | "not"
  | "boolAnd"
  | "boolOr"
  | "bitAnd"
  | "bitOr"
  | "bitXor"
  | "bitShift"
  | "equality"
  | "compare"
  | "number"
  | "string"
  | "identifier"
  | "invalid"
  | "eof";

type Token = {
  kind: TokenKind;
  text: string;
  position: number;
};

type FunctionDef = {
  name: string;
  parameterNames: string[];
  body: ((state: TruthState, args: number[]) => number) | null;
};

export type ExpressionSocketView = Pick<CircuitTestSocket, "inputs" | "outputs">;

const INT32_MAX = 0x7fffffff;
const UINT32_MAX = 0xffffffffn;

const BINARY_LITERAL_RE = /^0[bB][01](?:[_']?[01])*/;
const HEX_LITERAL_RE = /^0[xX][0-9a-fA-F](?:[_']?[0-9a-fA-F])*/;
const OCTAL_LITERAL_RE = /^0(?:[_']?[0-7])*/;
const DECIMAL_LITERAL_RE = /^[1-9](?:[_']?[0-9])*/;
const IDENTIFIER_RE = /^[_a-zA-Z][_a-zA-Z0-9]*/;

function normalizeInt32(value: number): number {
  return (value | 0) + 0;
}

function unquoteIdentifier(tokenText: string): string {
  const inner = tokenText.slice(1, -1);
  return inner.replace(/\\"/g, "\"");
}

function formatTokenDisplay(token: Token): string {
  if (token.kind === "eof") {
    return "<EOF>";
  }
  return `'${token.text}'`;
}

// Lexer + rekursiver Prädikats-Parser analog zu ExpressionParser.cs / TruthTableFilterLexer.g4 / TruthTableFilterParser.g4
export class ExpressionParser {
  readonly #socket: ExpressionSocketView | null;
  #errorCount = 0;
  #errors: string[] = [];

  constructor(socket: ExpressionSocketView | null | undefined) {
    this.#socket = socket ?? null;
  }

  get errorCount(): number {
    return this.#errorCount;
  }

  get errorText(): string {
    return this.#errors.join("\n");
  }

  parse(text: string): ((state: TruthState) => number) | null;
  parse(text: string, inverted: boolean): ((state: TruthState) => boolean) | null;
  parse(
    text: string,
    inverted?: boolean,
  ): ((state: TruthState) => number) | ((state: TruthState) => boolean) | null {
    const evaluator = this.#parseInternal(text);
    if (!evaluator) {
      return null;
    }
    if (inverted === undefined) {
      return evaluator;
    }
    if (inverted) {
      return (state: TruthState) => evaluator(state) === 0;
    }
    return (state: TruthState) => evaluator(state) !== 0;
  }

  parsePredicate(text: string, inverted: boolean): ((state: TruthState) => boolean) | null {
    return this.parse(text, inverted);
  }

  #resetErrors(): void {
    this.#errorCount = 0;
    this.#errors = [];
  }

  #addSyntaxError(message: string): void {
    this.#errors.push(i18n.t("errors.truthTableParser.syntaxError", { message }));
    this.#errorCount++;
  }

  #addError(message: string): void {
    this.#errors.push(i18n.t("errors.truthTableParser.errorMessage", { message }));
    this.#errorCount++;
  }

  #tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    let pos = 0;

    while (pos < text.length) {
      const ch = text[pos]!;

      // Whitespace überspringen
      if (ch === " " || ch === "\t" || ch === "\f" || ch === "\r" || ch === "\n") {
        pos++;
        continue;
      }

      // Blockkommentare /* ... */ überspringen
      if (ch === "/" && text[pos + 1] === "*") {
        const closeIdx = text.indexOf("*/", pos + 2);
        if (closeIdx === -1) {
          this.#addSyntaxError(
            i18n.t("errors.truthTableParser.unexpectedToken", { token: "'/*'" }),
          );
          tokens.push({ kind: "eof", text: "", position: text.length });
          return tokens;
        }
        pos = closeIdx + 2;
        continue;
      }

      const twoChar = text.slice(pos, pos + 2);
      if (twoChar === "&&") {
        tokens.push({ kind: "boolAnd", text: twoChar, position: pos });
        pos += 2;
        continue;
      }
      if (twoChar === "||") {
        tokens.push({ kind: "boolOr", text: twoChar, position: pos });
        pos += 2;
        continue;
      }
      if (twoChar === "<<" || twoChar === ">>") {
        tokens.push({ kind: "bitShift", text: twoChar, position: pos });
        pos += 2;
        continue;
      }
      if (twoChar === "==" || twoChar === "!=" || twoChar === "<>") {
        tokens.push({ kind: "equality", text: twoChar, position: pos });
        pos += 2;
        continue;
      }
      if (twoChar === "<=" || twoChar === ">=") {
        tokens.push({ kind: "compare", text: twoChar, position: pos });
        pos += 2;
        continue;
      }

      if (ch === "(") {
        tokens.push({ kind: "open", text: ch, position: pos });
        pos++;
        continue;
      }
      if (ch === ")") {
        tokens.push({ kind: "close", text: ch, position: pos });
        pos++;
        continue;
      }
      if (ch === ":") {
        tokens.push({ kind: "colon", text: ch, position: pos });
        pos++;
        continue;
      }
      if (ch === ",") {
        tokens.push({ kind: "comma", text: ch, position: pos });
        pos++;
        continue;
      }
      if (ch === "+" || ch === "-") {
        tokens.push({ kind: "add", text: ch, position: pos });
        pos++;
        continue;
      }
      if (ch === "*" || ch === "/" || ch === "%") {
        tokens.push({ kind: "mul", text: ch, position: pos });
        pos++;
        continue;
      }
      if (ch === "!" || ch === "~") {
        tokens.push({ kind: "not", text: ch, position: pos });
        pos++;
        continue;
      }
      if (ch === "&") {
        tokens.push({ kind: "bitAnd", text: ch, position: pos });
        pos++;
        continue;
      }
      if (ch === "|") {
        tokens.push({ kind: "bitOr", text: ch, position: pos });
        pos++;
        continue;
      }
      if (ch === "^") {
        tokens.push({ kind: "bitXor", text: ch, position: pos });
        pos++;
        continue;
      }
      if (ch === "=") {
        tokens.push({ kind: "equality", text: ch, position: pos });
        pos++;
        continue;
      }
      if (ch === "<" || ch === ">") {
        tokens.push({ kind: "compare", text: ch, position: pos });
        pos++;
        continue;
      }

      if (ch === "\"") {
        let end = pos + 1;
        let closed = false;
        while (end < text.length) {
          const cur = text[end]!;
          if (cur === "\\") {
            end += 2;
            continue;
          }
          if (cur === "\"") {
            end++;
            closed = true;
            break;
          }
          end++;
        }
        if (!closed) {
          this.#addSyntaxError(
            i18n.t("errors.truthTableParser.unexpectedToken", {
              token: `'${text.slice(pos)}'`,
            }),
          );
          tokens.push({ kind: "eof", text: "", position: text.length });
          return tokens;
        }
        tokens.push({ kind: "string", text: text.slice(pos, end), position: pos });
        pos = end;
        continue;
      }

      if (ch >= "0" && ch <= "9") {
        const slice = text.slice(pos);
        const match =
          BINARY_LITERAL_RE.exec(slice) ??
          HEX_LITERAL_RE.exec(slice) ??
          OCTAL_LITERAL_RE.exec(slice) ??
          DECIMAL_LITERAL_RE.exec(slice);
        if (match) {
          tokens.push({ kind: "number", text: match[0], position: pos });
          pos += match[0].length;
          continue;
        }
      }

      const idMatch = IDENTIFIER_RE.exec(text.slice(pos));
      if (idMatch) {
        tokens.push({ kind: "identifier", text: idMatch[0], position: pos });
        pos += idMatch[0].length;
        continue;
      }

      this.#addSyntaxError(
        i18n.t("errors.truthTableParser.unexpectedToken", { token: `'${ch}'` }),
      );
      tokens.push({ kind: "invalid", text: ch, position: pos });
      pos++;
    }

    tokens.push({ kind: "eof", text: "", position: text.length });
    return tokens;
  }

  #parseInternal(text: string): ((state: TruthState) => number) | null {
    this.#resetErrors();
    const tokens = this.#tokenize(text);
    if (this.#errorCount > 0) {
      return null;
    }

    const inputIndexByName = new Map<string, number>();
    const outputIndexByName = new Map<string, number>();
    if (this.#socket) {
      this.#socket.inputs.forEach((pinSocket, index) => {
        inputIndexByName.set(pinSocket.pin.name, index);
      });
      this.#socket.outputs.forEach((pinSocket, index) => {
        outputIndexByName.set(pinSocket.pin.name, index);
      });
    }

    const hasPin = (name: string): boolean =>
      inputIndexByName.has(name) || outputIndexByName.has(name);

    const functions = new Map<string, FunctionDef>();
    let currentFunction: FunctionDef | null = null;
    let index = 0;

    const peek = (offset = 0): Token =>
      tokens[index + offset] ?? tokens[tokens.length - 1]!;

    const consume = (): Token => {
      const current = peek();
      if (index < tokens.length - 1) {
        index++;
      }
      return current;
    };

    const expect = (kind: TokenKind, expectedLabel: string): boolean => {
      const token = peek();
      if (token.kind === kind) {
        consume();
        return true;
      }
      this.#addSyntaxError(
        i18n.t("errors.truthTableParser.missingToken", {
          expected: expectedLabel,
          token: formatTokenDisplay(token),
        }),
      );
      return false;
    };

    const isFunctionHeaderAtStart = (): boolean => {
      if (peek(0).kind !== "identifier") {
        return false;
      }
      if (peek(1).kind === "colon") {
        return true;
      }
      if (peek(1).kind !== "open") {
        return false;
      }
      let lookahead = 2;
      if (peek(lookahead).kind !== "identifier") {
        return false;
      }
      lookahead++;
      while (peek(lookahead).kind === "comma") {
        lookahead++;
        if (peek(lookahead).kind !== "identifier") {
          return false;
        }
        lookahead++;
      }
      return peek(lookahead).kind === "close" && peek(lookahead + 1).kind === "colon";
    };

    const parseNumberLiteral = (tokenText: string): number => {
      const cleaned = tokenText.replace(/[_']/g, "");
      if (cleaned.startsWith("0x") || cleaned.startsWith("0X")) {
        const hexDigits = cleaned.slice(2);
        const value = BigInt(`0x${hexDigits}`);
        if (value > UINT32_MAX) {
          this.#addError(
            i18n.t("errors.truthTableParser.invalidNumber", { number: tokenText }),
          );
          return 0;
        }
        return normalizeInt32(Number(value));
      }

      if (cleaned.startsWith("0b") || cleaned.startsWith("0B")) {
        const binDigits = cleaned.slice(2);
        const value = BigInt(`0b${binDigits}`);
        if (value > UINT32_MAX) {
          this.#addError(
            i18n.t("errors.truthTableParser.invalidNumber", { number: tokenText }),
          );
          return 0;
        }
        return normalizeInt32(Number(value));
      }

      if (cleaned.startsWith("0")) {
        let value = 0n;
        for (const digit of cleaned) {
          value = (value << 3n) | BigInt(digit.charCodeAt(0) - 48);
          if (value > BigInt(INT32_MAX)) {
            this.#addError(
              i18n.t("errors.truthTableParser.invalidNumber", { number: tokenText }),
            );
            return 0;
          }
        }
        return normalizeInt32(Number(value));
      }

      const value = BigInt(cleaned);
      if (value > BigInt(INT32_MAX)) {
        this.#addError(
          i18n.t("errors.truthTableParser.invalidNumber", { number: tokenText }),
        );
        return 0;
      }
      return normalizeInt32(Number(value));
    };

    type EvalNode = ((state: TruthState, args: number[]) => number) | null;

    const combineBinary = (
      left: EvalNode,
      right: EvalNode,
      op: (a: number, b: number) => number,
    ): EvalNode => {
      if (!left || !right) {
        return null;
      }
      return (state, args) => op(left(state, args), right(state, args));
    };

    const parseExpr = (): EvalNode => parseBoolOr();

    const parseBoolOr = (): EvalNode => {
      let left = parseBoolAnd();
      while (peek().kind === "boolOr") {
        consume();
        left = combineBinary(left, parseBoolAnd(), (a, b) => (a !== 0 || b !== 0 ? 1 : 0));
      }
      return left;
    };

    const parseBoolAnd = (): EvalNode => {
      let left = parseEquality();
      while (peek().kind === "boolAnd") {
        consume();
        left = combineBinary(left, parseEquality(), (a, b) => (a !== 0 && b !== 0 ? 1 : 0));
      }
      return left;
    };

    const parseEquality = (): EvalNode => {
      let left = parseCompare();
      while (peek().kind === "equality") {
        const op = consume().text;
        const isEq = op === "=" || op === "==";
        left = combineBinary(
          left,
          parseCompare(),
          (a, b) => (isEq ? (a === b ? 1 : 0) : (a !== b ? 1 : 0)),
        );
      }
      return left;
    };

    const parseCompare = (): EvalNode => {
      let left = parseAdd();
      while (peek().kind === "compare") {
        const op = consume().text;
        left = combineBinary(left, parseAdd(), (a, b) => {
          if (op === "<") {
            return a < b ? 1 : 0;
          }
          if (op === "<=") {
            return a <= b ? 1 : 0;
          }
          if (op === ">=") {
            return a >= b ? 1 : 0;
          }
          return a > b ? 1 : 0;
        });
      }
      return left;
    };

    const parseAdd = (): EvalNode => {
      let left = parseMul();
      while (peek().kind === "add") {
        const isPlus = consume().text === "+";
        left = combineBinary(
          left,
          parseMul(),
          (a, b) => normalizeInt32(isPlus ? a + b : a - b),
        );
      }
      return left;
    };

    const parseMul = (): EvalNode => {
      let left = parseBitOr();
      while (peek().kind === "mul") {
        const op = consume().text;
        left = combineBinary(left, parseBitOr(), (a, b) => {
          if (op === "*") {
            return normalizeInt32(Math.imul(a, b));
          }
          if (b === 0) {
            return 0;
          }
          if (op === "/") {
            return normalizeInt32(Math.trunc(a / b));
          }
          return normalizeInt32(a % b);
        });
      }
      return left;
    };

    const parseBitOr = (): EvalNode => {
      let left = parseBitXor();
      while (peek().kind === "bitOr") {
        consume();
        left = combineBinary(left, parseBitXor(), (a, b) => normalizeInt32(a | b));
      }
      return left;
    };

    const parseBitXor = (): EvalNode => {
      let left = parseBitAnd();
      while (peek().kind === "bitXor") {
        consume();
        left = combineBinary(left, parseBitAnd(), (a, b) => normalizeInt32(a ^ b));
      }
      return left;
    };

    const parseBitAnd = (): EvalNode => {
      let left = parseBitShift();
      while (peek().kind === "bitAnd") {
        consume();
        left = combineBinary(left, parseBitShift(), (a, b) => normalizeInt32(a & b));
      }
      return left;
    };

    const parseBitShift = (): EvalNode => {
      let left = parseUnary();
      while (peek().kind === "bitShift") {
        const isLeftShift = consume().text === "<<";
        left = combineBinary(
          left,
          parseUnary(),
          (a, b) => normalizeInt32(isLeftShift ? a << b : a >> b),
        );
      }
      return left;
    };

    const parseUnary = (): EvalNode => {
      const token = peek();
      if (token.kind === "add" || token.kind === "not") {
        const op = consume().text;
        const inner = parseUnary();
        if (!inner) {
          return null;
        }
        switch (op) {
          case "+":
            return inner;
          case "-":
            return (state, args) => normalizeInt32(-inner(state, args));
          case "!":
            return (state, args) => (inner(state, args) === 0 ? 1 : 0);
          case "~":
            return (state, args) => normalizeInt32(~inner(state, args));
          default:
            return inner;
        }
      }
      return parsePrimary();
    };

    const resolveVariable = (name: string): EvalNode => {
      const inputIndex = inputIndexByName.get(name);
      if (inputIndex !== undefined) {
        return (state) => normalizeInt32(state.input[inputIndex] ?? 0);
      }

      const outputIndex = outputIndexByName.get(name);
      if (outputIndex !== undefined) {
        return (state) => normalizeInt32(state.output?.[outputIndex] ?? 0);
      }

      if (currentFunction) {
        const paramIdx = currentFunction.parameterNames.indexOf(name);
        if (paramIdx >= 0) {
          return (_state, args) => normalizeInt32(args[paramIdx] ?? 0);
        }
      }

      const fn = functions.get(name);
      if (fn) {
        if (fn.parameterNames.length === 0) {
          if (fn.body) {
            const fnBody = fn.body;
            return (state) => fnBody(state, []);
          }
          if (name === currentFunction?.name) {
            this.#addError(i18n.t("errors.truthTableParser.recursion", { name }));
          } else {
            this.#addError(i18n.t("errors.truthTableParser.functionUndefined", { name }));
          }
        } else {
          this.#addError(
            i18n.t("errors.truthTableParser.functionNumberParameters", { name }),
          );
        }
        return null;
      }

      this.#addError(i18n.t("errors.truthTableParser.unknownPin", { name }));
      return null;
    };

    const parseFunctionCall = (name: string): EvalNode => {
      consume(); // '('
      const argNodes: EvalNode[] = [];
      const firstArg = parseExpr();
      argNodes.push(firstArg);
      while (peek().kind === "comma") {
        consume();
        argNodes.push(parseExpr());
      }
      if (!expect("close", "')'")) {
        return null;
      }

      const fn = functions.get(name);
      if (!fn) {
        this.#addError(i18n.t("errors.truthTableParser.functionUndefined", { name }));
        return null;
      }

      if (!fn.body) {
        if (name === currentFunction?.name) {
          this.#addError(i18n.t("errors.truthTableParser.recursion", { name }));
        } else {
          this.#addError(i18n.t("errors.truthTableParser.functionUndefined", { name }));
        }
        return null;
      }

      if (argNodes.length !== fn.parameterNames.length) {
        this.#addError(
          i18n.t("errors.truthTableParser.functionNumberParameters", { name }),
        );
        return null;
      }

      if (this.#errorCount > 0 || argNodes.some((node) => node === null)) {
        return null;
      }

      const fnBody = fn.body;
      const resolvedArgs = argNodes as Array<(state: TruthState, args: number[]) => number>;
      return (state, callerArgs) => {
        const evaluatedArgs = resolvedArgs.map((argEval) => argEval(state, callerArgs));
        return fnBody(state, evaluatedArgs);
      };
    };

    const parsePrimary = (): EvalNode => {
      const token = peek();
      if (token.kind === "open") {
        consume();
        const inner = parseExpr();
        if (!expect("close", "')'")) {
          return null;
        }
        return inner;
      }

      if (token.kind === "number") {
        consume();
        const literal = parseNumberLiteral(token.text);
        return () => literal;
      }

      if (token.kind === "string") {
        consume();
        const variableName = unquoteIdentifier(token.text);
        return resolveVariable(variableName);
      }

      if (token.kind === "identifier") {
        consume();
        if (peek().kind === "open") {
          return parseFunctionCall(token.text);
        }
        return resolveVariable(token.text);
      }

      this.#addSyntaxError(
        i18n.t("errors.truthTableParser.unexpectedToken", {
          token: formatTokenDisplay(token),
        }),
      );
      return null;
    };

    const parseFunctionDefinition = (): void => {
      const fnNameToken = consume();
      const functionName = fnNameToken.text;
      const parameterNames: string[] = [];

      if (peek().kind === "open") {
        consume();
        while (peek().kind === "identifier") {
          const paramName = consume().text;
          if (hasPin(paramName)) {
            this.#addError(
              i18n.t("errors.truthTableParser.parameterConflictsWithPin", {
                parameterName: paramName,
                functionName,
              }),
            );
          } else if (parameterNames.includes(paramName)) {
            this.#addError(
              i18n.t("errors.truthTableParser.parameterDuplicated", {
                parameterName: paramName,
                functionName,
              }),
            );
          } else if (functionName === paramName) {
            this.#addError(
              i18n.t("errors.truthTableParser.parameterConflictsWithFunction", {
                parameterName: paramName,
                functionName,
              }),
            );
          } else {
            parameterNames.push(paramName);
          }

          if (peek().kind === "comma") {
            consume();
          } else {
            break;
          }
        }
        expect("close", "')'");
      }

      expect("colon", "':'");

      let canRegister = true;
      if (hasPin(functionName)) {
        this.#addError(
          i18n.t("errors.truthTableParser.functionConflictsWithPin", { functionName }),
        );
        canRegister = false;
      } else if (functions.has(functionName)) {
        this.#addError(
          i18n.t("errors.truthTableParser.functionRedefined", { functionName }),
        );
        canRegister = false;
      }

      const fnDef: FunctionDef = {
        name: functionName,
        parameterNames,
        body: null,
      };
      if (canRegister) {
        functions.set(functionName, fnDef);
      }

      const previousFunction = currentFunction;
      currentFunction = fnDef;
      try {
        const body = parseExpr();
        if (canRegister && body && this.#errorCount === 0) {
          fnDef.body = body;
        }
      } finally {
        currentFunction = previousFunction;
      }
    };

    while (isFunctionHeaderAtStart()) {
      parseFunctionDefinition();
      if (this.#errorCount > 0) {
        return null;
      }
    }

    const rootExpr = parseExpr();
    if (this.#errorCount > 0 || !rootExpr) {
      return null;
    }

    const trailing = peek();
    if (trailing.kind !== "eof") {
      this.#addSyntaxError(
        i18n.t("errors.truthTableParser.unexpectedToken", {
          token: formatTokenDisplay(trailing),
        }),
      );
      return null;
    }

    return (state: TruthState) => rootExpr(state, []);
  }
}

export default ExpressionParser;
