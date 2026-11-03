import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/components/inputs/OtpSixInput.tsx', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
});

// Exercise the real component handlers while the host owns native text/selection.
function mountOtp(value = '', platform = 'android', readClipboard = async () => '') {
  const hooks = [];
  let cursor = 0;
  let dirty = false;
  let tree;
  let effects = [];
  let unmounted = false;
  let syncText = false;
  const changes = [];
  const props = { value, onChange: next => { props.value = next; changes.push(next); dirty = true; } };
  const host = {
    value, selectionStart: 0, selectionEnd: 0, focused: false,
    isFocused: () => host.focused,
    focus() {
      if (!host.focused) {
        host.focused = true;
        input().props.onFocus();
      }
    },
    setSelectionRange(start, end) {
      host.selectionStart = Math.max(0, Math.min(start, host.value.length));
      host.selectionEnd = Math.max(host.selectionStart, Math.min(end, host.value.length));
    },
  };
  const react = {
    createElement: (type, elementProps, ...children) => ({ type, props: { ...elementProps, children } }),
    useRef(initial) {
      const index = cursor++;
      return hooks[index] ??= { current: initial };
    },
    useState(initial) {
      const index = cursor++;
      const state = hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [state.value, next => { state.value = typeof next === 'function' ? next(state.value) : next; dirty = true; }];
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = hooks[index];
      if (!previous || !dependencies || dependencies.some((dependency, i) => !Object.is(dependency, previous.dependencies?.[i]))) {
        effects.push(() => {
          previous?.cleanup?.();
          hooks[index] = { dependencies, cleanup: effect() };
        });
      }
    },
  };
  react.useLayoutEffect = react.useEffect;
  react.default = react;
  const dependencies = {
    react,
    'react-native': {
      Platform: { OS: platform, select: options => options[platform] ?? options.default ?? {} },
      StyleSheet: { create: styles => styles },
      TextInput: 'TextInput', Pressable: 'Pressable', Text: 'Text', View: 'View',
    },
    'expo-clipboard': { getStringAsync: readClipboard },
    '@/theme/ThemeProvider': { useAppTheme: () => ({ colors: {} }) },
    '@/theme/tokens': { radii: {}, typography: {} },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unmapped dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children)];
  }
  function input() { return nodes(tree).find(node => node.type === 'TextInput'); }
  function flush() {
    let count = 0;
    do {
      assert.ok(++count < 20, 'Component render did not settle');
      dirty = false;
      cursor = 0;
      effects = [];
      const previousSelection = input()?.props.selection;
      const previousValue = input()?.props.value;
      tree = module.exports.OtpSixInput(props);
      const field = input();
      field.props.ref.current = host;
      if (syncText || field.props.value !== previousValue) {
        host.value = field.props.value;
        host.setSelectionRange(host.selectionStart, host.selectionEnd);
        syncText = false;
      }
      if (field.props.selection && field.props.selection !== previousSelection) {
        host.setSelectionRange(field.props.selection.start, field.props.selection.end);
      }
      effects.forEach(run => run());
    } while (dirty && !unmounted);
  }
  function select(start, end = start) {
    host.setSelectionRange(start, end);
    input().props.onSelectionChange({ nativeEvent: { selection: { start, end } } });
    flush();
  }
  function change(raw, selection, order = 'text-first') {
    host.value = raw;
    host.setSelectionRange(selection.start, selection.end);
    const emitSelection = () => {
      input().props.onSelectionChange({ nativeEvent: { selection } });
      flush();
    };
    if (order === 'selection-first') emitSelection();
    const field = input();
    syncText = true;
    if (field.props.onChange) {
      field.props.onChange({ nativeEvent: { text: raw, ...(platform === 'web' ? {} : { selection }) }, target: host });
    } else {
      field.props.onChangeText(raw);
    }
    flush();
    if (order === 'text-first') emitSelection();
  }
  function insert(text, order) {
    const start = host.selectionStart;
    const raw = host.value.slice(0, start) + text + host.value.slice(host.selectionEnd);
    change(raw, { start: start + text.length, end: start + text.length }, order);
  }
  function backspace(order) {
    const start = host.selectionStart;
    const end = host.selectionEnd;
    const from = start === end ? Math.max(0, start - 1) : start;
    change(host.value.slice(0, from) + host.value.slice(end), { start: from, end: from }, order);
  }
  flush();
  return {
    changes, input, insert, backspace, select, change,
    value: () => props.value,
    selection: () => ({ start: host.selectionStart, end: host.selectionEnd }),
    slot: index => nodes(tree).filter(node => node.type === 'Pressable')[index],
    focus() { host.focus(); flush(); },
    blur() { host.focused = false; input().props.onBlur(); flush(); },
    press(index) { this.slot(index).props.onPress(); flush(); },
    update(next) { Object.assign(props, next); flush(); },
    unmount() { unmounted = true; hooks.forEach(hook => hook?.cleanup?.()); },
  };
}

for (const platform of ['android', 'ios', 'web']) {
  for (const order of ['text-first', 'selection-first']) {
    test(`${platform}: native backspace/correction keeps caret (${order})`, () => {
      const otp = mountOtp('012345', platform);
      otp.focus();
      otp.backspace(order);
      otp.backspace(order);
      assert.equal(otp.value(), '0123');
      assert.deepEqual(otp.selection(), { start: 4, end: 4 });
      otp.press(1);
      assert.deepEqual(otp.selection(), { start: 1, end: 2 }, 'Tap selects the filled digit');
      otp.backspace(order);
      assert.equal(otp.value(), '023');
      assert.deepEqual(otp.selection(), { start: 1, end: 1 });
      otp.update({ value: '012345' });
      otp.press(2);
      otp.insert('9', order);
      assert.equal(otp.value(), '019345');
      assert.deepEqual(otp.selection(), { start: 3, end: 3 });
      otp.backspace(order);
      assert.equal(otp.value(), '01345');
      otp.select(0, 5);
      otp.backspace(order);
      assert.equal(otp.value(), '');
      for (const digit of '000123') otp.insert(digit, order);
      assert.equal(otp.value(), '000123');
      assert.deepEqual(otp.selection(), { start: 6, end: 6 });
    });
  }
}

test('repeated digits and keyboard selected ranges retain native delete behavior', () => {
  const otp = mountOtp('111111');
  otp.focus();
  otp.select(3);
  otp.backspace('selection-first');
  otp.backspace('text-first');
  assert.equal(otp.value(), '1111');
  assert.deepEqual(otp.selection(), { start: 1, end: 1 });
  otp.select(1, 3);
  otp.insert('0', 'selection-first');
  assert.equal(otp.value(), '101');
  otp.select(0, 3);
  otp.insert('012345', 'selection-first');
  assert.equal(otp.value(), '012345');
});

for (const platform of ['android', 'ios', 'web']) {
 for (const order of ['text-first', 'selection-first']) {
  test(`${platform}: full code paste replaces whole value at any caret/range (${order})`, () => {
    for (const [start, end] of [[0, 0], [2, 2], [6, 6], [2, 3], [1, 5], [0, 6]]) {
      const otp = mountOtp('123456', platform);
      otp.focus();
      otp.select(start, end);
      otp.insert('012345', order);
      assert.equal(otp.value(), '012345', `Selection ${start}:${end}`);
      assert.deepEqual(otp.selection(), { start: 6, end: 6 });
    }
  });
 }
}

test('partial paste follows native selection and preserves leading zeroes', () => {
  const otp = mountOtp('123456');
  otp.focus();
  otp.select(1, 4);
  otp.insert('00', 'selection-first');
  assert.equal(otp.value(), '10056');
  assert.deepEqual(otp.selection(), { start: 3, end: 3 });
  otp.select(2);
  otp.insert('89', 'text-first');
  assert.equal(otp.value(), '108905');
  assert.deepEqual(otp.selection(), { start: 4, end: 4 });
});

test('external resend clear clamps selection, and focused slot press cannot suppress later focus', () => {
  const otp = mountOtp('123456');
  otp.focus();
  otp.press(1);
  otp.blur();
  otp.focus();
  assert.deepEqual(otp.selection(), { start: 6, end: 6 });
  otp.update({ value: '' });
  assert.deepEqual(otp.selection(), { start: 0, end: 0 });
  otp.select(6);
  assert.deepEqual(otp.input().props.selection, { start: 0, end: 0 }, 'Ignore a stale selection from before resend');
  otp.insert('0', 'selection-first');
  assert.equal(otp.value(), '0');
});

test('one real input keeps autofill, accessibility and disabled editability', () => {
  const otp = mountOtp('012345');
  assert.equal(otp.input().props.autoComplete, 'one-time-code');
  assert.equal(otp.input().props.textContentType, 'oneTimeCode');
  assert.equal(otp.input().props.accessibilityLabel, 'Código de 6 dígitos');
  assert.equal(otp.input().props.onKeyPress, undefined);
  otp.update({ disabled: true });
  assert.equal(otp.input().props.editable, false);
  otp.change('01234', { start: 5, end: 5 });
  assert.deepEqual(otp.changes, [], 'Ignore a queued native edit after disable');
});

for (const stoppedBy of ['unmount', 'disable', 'disable then enable']) {
  test(`clipboard result cannot change code after ${stoppedBy}`, async () => {
    let resolve;
    const otp = mountOtp('123', 'android', () => new Promise(done => { resolve = done; }));
    otp.focus();
    const pending = otp.slot(0).props.onLongPress();
    if (stoppedBy === 'unmount') otp.unmount();
    else {
      otp.update({ disabled: true });
      if (stoppedBy === 'disable then enable') otp.update({ disabled: false });
    }
    resolve('012345');
    await pending;
    assert.deepEqual(otp.changes, []);
  });
}
