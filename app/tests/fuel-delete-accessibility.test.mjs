import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// TypeScript accepts more roles than the Android accessibilityRole setter does.
// Check the rendered native props against the installed Android implementation.
const delegate = readFileSync(new URL('../node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/ReactAccessibilityDelegate.kt', import.meta.url), 'utf8');
function androidRoles(name) {
  const body = delegate.split(`public enum class ${name} {`)[1]?.split(';')[0];
  assert.ok(body, `Missing Android ${name} enum`);
  return new Set([...body.matchAll(/\b([A-Z][A-Z0-9_]*)\b/g)].map(match => match[1].toLowerCase()));
}
const accessibilityRoles = androidRoles('AccessibilityRole');
const roles = androidRoles('Role');

function renderSheet(pending) {
  let stateIndex = 0;
  const entry = { occurredAt: '2026-11-01T12:00:00Z', paidTotal: '100', liters: '20', odometerKm: 1000 };
  const states = [entry, pending, null, false];
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: () => [states[stateIndex++], () => {}],
    useRef: current => ({ current }),
    useEffect: () => {},
  };
  react.default = react;
  const dependencies = {
    react,
    'react-native': { Text: 'Text' },
    '@/api/endpoints': {},
    '@/api/types': {},
    '@/components/feedback/InlineNotice': { InlineNotice: 'InlineNotice' },
    '@/components/overlays/AppSheet': { AppSheet: 'AppSheet' },
    '@/components/ui/PrimaryButton': { PrimaryButton: 'PrimaryButton' },
    '@/state/SessionContext': { useSession: () => ({}) },
    '@/theme/ThemeProvider': { useAppTheme: () => ({ colors: {} }) },
    '@/theme/tokens': { typography: {} },
    '@/utils/date': { formatDateTimeFullBR: value => value },
    '@/utils/decimal': Object.fromEntries(['formatCurrencyBRL', 'formatLitersBR', 'formatOdometerBR'].map(name => [name, value => value])),
  };
  const source = readFileSync(new URL('../src/features/history/components/DeleteFuelEntrySheet.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unmapped dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports.DeleteFuelEntrySheet({ entry, vehicleName: 'Carro', onClose() {}, onDeleted() {} });
}

function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}

for (const pending of [false, true]) {
  test(`delete confirmation uses Android-supported accessibility props (pending=${pending})`, () => {
    const rendered = nodes(renderSheet(pending));
    for (const { props } of rendered) {
      if (props.accessibilityRole) assert.ok(accessibilityRoles.has(props.accessibilityRole), `Invalid Android accessibilityRole: ${props.accessibilityRole}`);
      if (props.role) assert.ok(roles.has(props.role), `Invalid Android role: ${props.role}`);
    }
    const notices = rendered.filter(node => node.props.accessibilityLiveRegion === 'polite');
    assert.equal(notices.length, pending ? 1 : 0);
    if (pending) assert.equal(notices[0].props.role, 'status', 'Preserve status semantics while awaiting DELETE or conflict refresh');
  });
}
