/**
 * The source audit behind lib/experimental-guard.test.mjs (docs/BLOCKS.md,
 * "The experimental build"). It reads the TypeScript syntax tree of one app
 * source and reports:
 *
 * - `guarded`: how many `import()` of block code are enclosed by the literal
 *   flag check, so that Next's inlining and webpack's constant folding remove
 *   them from a default build;
 * - `unguarded`: every `import()` of block code that is not (file:line);
 * - `staticOffenders`: every static value import or re-export of block code
 *   (file:line: specifier). Type-only forms compile to nothing and pass.
 *
 * "Block code" is the experimental directory (the runtime and the sidecars)
 * and the `@dspack-studio/composer-core/blocks` subpath.
 *
 * What counts as the guard is deliberately narrow, and it is the construct
 * webpack folds, not a textual neighbourhood: the import must lie in the
 * then-branch of an `if`, the true arm of a ternary, or the right operand of
 * an `&&`, whose test is the exact `process.env.NEXT_PUBLIC_COMPOSER_EXPERIMENTAL === "1"`
 * comparison (either order), or an `&&` chain whose FIRST operand is that
 * comparison. The first operand is required because webpack decides
 * `false && anything` from the left alone; a literal later in the chain is
 * not folded. A negated or `!==` test, the else branch, the false arm, a
 * `||`, a named constant, a bare truthiness read and a bracket access are all
 * unguarded. A `typeof import(...)` type query is not an import.
 */
import ts from "typescript";

const FLAG = "NEXT_PUBLIC_COMPOSER_EXPERIMENTAL";

/** Whether a module specifier names block code. */
export const isBlockCode = (spec) => spec.includes("composer-core/blocks") || spec.includes("experimental/");

const unparen = (node) => {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
};

/** `process.env.NEXT_PUBLIC_COMPOSER_EXPERIMENTAL`, dotted. */
const isFlagRead = (node) =>
  ts.isPropertyAccessExpression(node) &&
  node.name.text === FLAG &&
  ts.isPropertyAccessExpression(node.expression) &&
  node.expression.name.text === "env" &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === "process";

/** `process.env.NEXT_PUBLIC_COMPOSER_EXPERIMENTAL === "1"`, in either order. */
const isFlagCheck = (node) => {
  const n = unparen(node);
  if (!ts.isBinaryExpression(n) || n.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) return false;
  const sides = [unparen(n.left), unparen(n.right)];
  return sides.some(isFlagRead) && sides.some((s) => ts.isStringLiteral(s) && s.text === "1");
};

/** The test is the flag check, or an `&&` chain that begins with it. */
const guardsTruthy = (test) => {
  let n = unparen(test);
  while (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) n = unparen(n.left);
  return isFlagCheck(n);
};

/** Whether a node lies where the flag check is known to be true. */
const isGuarded = (start) => {
  for (let node = start; node.parent; node = node.parent) {
    const parent = node.parent;
    if (ts.isIfStatement(parent) && parent.thenStatement === node && guardsTruthy(parent.expression)) return true;
    if (ts.isConditionalExpression(parent) && parent.whenTrue === node && guardsTruthy(parent.condition)) return true;
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      parent.right === node &&
      guardsTruthy(parent.left)
    ) {
      return true;
    }
  }
  return false;
};

const specifierOf = (node) => {
  const arg = node.arguments[0];
  if (!arg) return "";
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  return arg.getText();
};

/**
 * Audit one app source. `fileName` is used for the report and to pick the
 * TSX grammar; the text is parsed, never executed.
 */
export function auditSource(text, fileName) {
  const kind = fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const line = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const unguarded = [];
  const staticOffenders = [];
  let guarded = 0;

  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const spec = node.moduleSpecifier.text;
      // `import type { … } from` is erased. An import clause whose every
      // binding is an inline `type` is not: under isolatedModules the
      // declaration can survive as a bare import, so it is refused here.
      const typeOnly = node.importClause?.isTypeOnly === true;
      if (isBlockCode(spec) && !typeOnly) staticOffenders.push(`${fileName}:${line(node)}: ${spec}`);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const spec = node.moduleSpecifier.text;
      if (isBlockCode(spec) && !node.isTypeOnly) staticOffenders.push(`${fileName}:${line(node)}: ${spec}`);
    } else if (ts.isCallExpression(node)) {
      const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const required = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if ((dynamic || required) && isBlockCode(specifierOf(node))) {
        if (dynamic && isGuarded(node)) guarded += 1;
        else unguarded.push(`${fileName}:${line(node)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { guarded, unguarded, staticOffenders };
}
