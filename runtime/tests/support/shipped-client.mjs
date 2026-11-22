// Extract real shipped declarations without depending on bundler region comments.
// Names supplied by the fixture remain its boundary adapters; all other code is
// copied byte for byte from the installed bundle, including its dependency closure.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const prefix = process.env.DSH_TEST_PREFIX ?? process.env.DSH_PREFIX;
const { parse } = createRequire(resolve(prefix, 'package.json'))('acorn');
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) for (const child of value) walk(child, visit);
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
function patternNames(node, names) {
  if (!node) return;
  if (node.type === 'Identifier') names.add(node.name);
  else if (node.type === 'RestElement') patternNames(node.argument, names);
  else if (node.type === 'AssignmentPattern') patternNames(node.left, names);
  else if (node.type === 'ArrayPattern') for (const item of node.elements) patternNames(item, names);
  else if (node.type === 'ObjectPattern') for (const item of node.properties) patternNames(item.value ?? item.argument, names);
}
function locals(node, names) {
  if (!node || typeof node !== 'object') return;
  if (/Function/.test(node.type)) { if (node.type === 'FunctionDeclaration') patternNames(node.id, names); return; }
  if (node.type === 'ClassDeclaration') { patternNames(node.id, names); return; }
  if (node.type === 'VariableDeclarator') patternNames(node.id, names);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const item of value) locals(item, names);
    else if (value && typeof value === 'object') locals(value, names);
  }
}
function references(node, scopes, refs, parent, key) {
  if (!node || typeof node !== 'object') return;
  if (/Function/.test(node.type)) {
    const scope = new Set(); patternNames(node.id, scope);
    for (const parameter of node.params) patternNames(parameter, scope);
    locals(node.body, scope);
    references(node.body, [...scopes, scope], refs, node, 'body');
    for (const parameter of node.params) if (parameter.type === 'AssignmentPattern') references(parameter.right, [...scopes, scope], refs);
    return;
  }
  if (node.type === 'VariableDeclarator') { references(node.init, scopes, refs); return; }
  if (node.type === 'Identifier') {
    if (key === 'key' && ['Property', 'MethodDefinition', 'PropertyDefinition'].includes(parent?.type) && !parent.computed) return;
    if (key === 'property' && parent?.type === 'MemberExpression' && !parent.computed) return;
    if (key === 'id' || key === 'label') return;
    if (!scopes.some(scope => scope.has(node.name))) refs.add(node.name);
    return;
  }
  for (const [name, value] of Object.entries(node)) {
    if (Array.isArray(value)) for (const child of value) references(child, scopes, refs, node, name);
    else if (value && typeof value === 'object') references(value, scopes, refs, node, name);
  }
}
export function shippedClient(source, names, provided = []) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  let factory;
  walk(ast, node => {
    if (node.type === 'Property' && node.key.name === 'factory') factory = node.value;
  });
  if (!factory?.body?.body) throw Error('Shipped module factory is missing');
  return shippedDeclarations(source, factory.body.body, names, provided);
}
export function shippedDeclarations(source, statements, names, provided = []) {
  const external = new Set(provided), declarations = new Map(), selected = new Set();
  const bindings = statement => {
    if (statement.type === 'VariableDeclaration') return statement.declarations.flatMap(item => item.id.type === 'Identifier' ? [item.id.name] : []);
    return statement.id?.name ? [statement.id.name] : [];
  };
  for (const statement of statements) for (const name of bindings(statement)) declarations.set(name, statement);
  const needed = [...names];
  while (needed.length) {
    const name = needed.pop(), statement = declarations.get(name);
    if (external.has(name) || !statement || selected.has(statement)) continue;
    selected.add(statement);
    const refs = new Set();
    references(statement, [new Set(bindings(statement))], refs);
    needed.push(...refs);
  }
  for (const name of names) if (!declarations.has(name) && !external.has(name)) throw Error('Missing shipped declaration: ' + name);
  return statements.filter(statement => selected.has(statement)).map(statement => source.slice(statement.start, statement.end)).join('\n') + '\n({' + names.join(',') + '})';
}
export function shippedScript(source, names, provided = []) {
  return shippedDeclarations(source, parse(source, { ecmaVersion: 'latest', sourceType: 'script' }).body, names, provided);
}

export function shippedFrontend(source, names) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const aliases = {};
  walk(ast, node => {
    if (node.type !== 'Property') return;
    const key = node.key.name ?? node.key.value;
    if (names.includes(key) && node.value.type === 'Identifier') aliases[key] = node.value.name;
  });
  for (const name of names) if (!aliases[name]) throw Error('Missing shipped export: ' + name);
  const keys = Object.values(aliases);
  const code = shippedDeclarations(source, ast.body, keys);
  return code.slice(0, code.lastIndexOf('\n({')) + '\n({' + Object.entries(aliases).map(([name, value]) => name + ':' + value).join(',') + '})';
}
