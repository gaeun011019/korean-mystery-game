import test from 'node:test';
import assert from 'node:assert/strict';
import { caseData, cases } from '../src/case-data.js';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

// 브라우저나 레이아웃 검사가 아니다. 실제 HTML에 있는 버튼과 등록된 이벤트를 연결한다.
function createDocumentAdapter() {
  const handlers = new Map();
  const focusCalls = [];
  const scrollCalls = [];
  const app = {
    innerHTML: '',
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
    querySelectorAll(selector) {
      assert.equal(selector, '[data-action]');
      return buttons();
    },
  };

  function buttons() {
    const result = [];

    for (const match of app.innerHTML.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
      const attributes = match[2];
      const action = attributes.match(/\bdata-action="([^"]*)"/)?.[1];

      if (!action) {
        continue;
      }

      result.push({
        dataset: {
          action,
          value: attributes.match(/\bdata-value="([^"]*)"/)?.[1] ?? '',
        },
        disabled: /(?:^|\s)disabled(?:\s|=|$)/.test(attributes),
        text: match[3],
        focus() {
          focusCalls.push(action);
        },
      });
    }

    return result;
  }

  function findButton(action, value = '') {
    const button = buttons().find((item) => (
      item.dataset.action === action && item.dataset.value === value
    ));

    assert.ok(button, `화면에 있는 버튼이어야 한다: ${action} ${value}`);
    return button;
  }

  function click(action, value = '') {
    const button = findButton(action, value);
    handlers.get('click')({
      target: {
        closest(selector) {
          assert.equal(selector, '[data-action]');
          return button;
        },
      },
      preventDefault() {},
    });
  }

  function changeSelection(name, value) {
    const select = [...app.innerHTML.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)]
      .find((match) => match[1].includes(`name="${name}"`));

    assert.ok(select, `화면에 있는 선택 항목이어야 한다: ${name}`);
    assert.ok(select[2].includes(`value="${value}"`), `선택 가능한 값이어야 한다: ${value}`);
    handlers.get('change')({
      target: {
        name,
        value,
        closest(selector) {
          assert.equal(selector, '#solution-form');
          return { id: 'solution-form' };
        },
      },
    });
  }

  function submit() {
    assert.ok(app.innerHTML.includes('id="solution-form"'));
    handlers.get('submit')({
      target: { id: 'solution-form' },
      preventDefault() {},
    });
  }

  function querySelector(selector) {
    if (selector === '#app') {
      return app;
    }

    const marker = selector.startsWith('#')
      ? `id="${selector.slice(1)}"`
      : `class="${selector.slice(1)}"`;

    if (!app.innerHTML.includes(marker)) {
      return null;
    }

    return {
      setAttribute(name, value) {
        assert.equal(name, 'tabindex');
        assert.equal(value, '-1');
      },
      focus() {
        focusCalls.push(selector);
      },
      scrollIntoView() {
        scrollCalls.push(selector);
      },
    };
  }

  return {
    app,
    buttons,
    findButton,
    click,
    changeSelection,
    submit,
    document: { querySelector },
    window: { scrollTo: (options) => scrollCalls.push(options) },
    focusCalls,
    scrollCalls,
  };
}

test('실제 화면 렌더와 이벤트 연결: 조사·증거 제시·오답·해설·재시작 (브라우저 제외)', async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const ui = createDocumentAdapter();
  const visible = (text) => ui.app.innerHTML.includes(escapeHtml(text));

  function notebookCounts(facts, statements) {
    assert.ok(ui.app.innerHTML.includes(`<h2>관찰한 사실</h2><span>${facts}개의 기록</span>`));
    assert.ok(ui.app.innerHTML.includes(`<h2>인물의 진술</h2><span>${statements}개의 기록</span>`));
  }

  try {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: ui.document });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: ui.window });
    await import('../src/app.js');

    assert.ok(visible('오늘 펼칠 사건 수첩'));
    ui.click('open-case', caseData.id);

    assert.ok(visible(caseData.subtitle));
    assert.ok(!visible(caseData.ending.title));
    assert.ok(caseData.hints.every((hint) => !visible(hint)));
    assert.equal(ui.findButton('navigate', 'investigate').disabled, true);

    ui.click('start');
    assert.ok(ui.app.innerHTML.includes('확보한 단서 <b>0 / 6</b>'));
    ui.click('navigate', 'talk');
    assert.ok(visible(caseData.suspects[0].initial));

    for (const question of caseData.questions.filter((item) => (
      item.personId === caseData.suspects[0].id && item.requiresClues.length > 0
    ))) {
      assert.equal(ui.findButton('question', question.id).disabled, true);
      assert.ok(!visible(question.label), `잠긴 질문 제목을 공개하지 않는다: ${question.id}`);
    }

    const lockedQuestion = caseData.questions.find((item) => (
      item.personId === caseData.suspects[0].id && item.requiresClues.length > 0
    ));
    const beforeLockedClick = ui.app.innerHTML;
    ui.click('question', lockedQuestion.id);
    assert.equal(ui.app.innerHTML, beforeLockedClick);

    const firstClue = caseData.clues[0];
    ui.click('navigate', 'investigate');
    ui.click('location', firstClue.locationId);
    ui.click('inspect', firstClue.id);
    ui.click('inspect', firstClue.id);
    ui.click('navigate', 'notebook');
    notebookCounts(1, 1);
    assert.ok(visible(firstClue.note));

    ui.click('navigate', 'investigate');

    for (const clue of [...caseData.clues].reverse()) {
      ui.click('location', clue.locationId);
      ui.click('inspect', clue.id);
      assert.ok(visible(clue.name));
      assert.ok(visible(clue.description[0]));
    }

    assert.ok(ui.app.innerHTML.includes('확보한 단서 <b>6 / 6</b>'));
    ui.click('navigate', 'submit');
    ui.changeSelection('suspectId', caseData.answer.suspectId);
    ui.changeSelection('sceneClueId', caseData.answer.sceneClueId);
    ui.changeSelection('routeClueId', caseData.answer.routeClueId);
    ui.submit();
    assert.ok(visible('조사를 조금 더 이어가세요.'));
    assert.ok(ui.app.innerHTML.includes('제출한 추리 <b>0회</b>'));
    assert.ok(!visible(caseData.ending.title));

    ui.click('navigate', 'talk');
    const asked = new Set();
    let changed;

    do {
      changed = false;

      for (const person of caseData.suspects) {
        ui.click('person', person.id);
        assert.ok(visible(person.initial));

        for (const question of caseData.questions.filter((item) => item.personId === person.id)) {
          if (asked.has(question.id) || ui.findButton('question', question.id).disabled) {
            continue;
          }

          ui.click('question', question.id);
          assert.ok(visible(question.label));
          assert.ok(visible(question.response[0]));
          asked.add(question.id);
          changed = true;
        }
      }
    } while (changed);

    assert.equal(asked.size, caseData.questions.length);
    const reread = caseData.questions[0];
    ui.click('person', reread.personId);
    ui.click('question', reread.id);
    ui.click('question', reread.id);
    assert.ok(visible(reread.response[0]));
    ui.click('initial', reread.personId);
    assert.ok(visible(caseData.suspects.find((person) => person.id === reread.personId).initial));
    ui.click('navigate', 'notebook');

    const facts = caseData.clues.length + caseData.questions.filter((question) => question.fact).length;
    const statements = caseData.suspects.length + caseData.questions.length;
    notebookCounts(facts, statements);
    assert.ok(caseData.hints.every((hint) => !visible(hint)));
    assert.ok(!visible(caseData.ending.title));

    ui.click('toggle-hints');
    assert.ok(caseData.hints.every((hint) => !visible(hint)));

    for (let index = 0; index < caseData.hints.length; index += 1) {
      ui.click('hint');
      assert.ok(caseData.hints.slice(0, index + 1).every(visible));
      assert.ok(caseData.hints.slice(index + 1).every((hint) => !visible(hint)));
    }

    assert.equal(ui.buttons().some((button) => button.dataset.action === 'hint'), false);
    ui.click('toggle-hints');
    assert.ok(caseData.hints.every((hint) => !visible(hint)));

    ui.click('navigate', 'submit');
    const wrongPerson = caseData.suspects.find((person) => person.id !== caseData.answer.suspectId);
    ui.changeSelection('suspectId', wrongPerson.id);
    ui.submit();
    assert.ok(visible('이 설명만으로는 사건이 완성되지 않습니다.'));
    assert.ok(ui.app.innerHTML.includes('제출한 추리 <b>1회</b>'));
    assert.ok(!visible(caseData.ending.title));
    ui.click('navigate', 'investigate');
    assert.ok(ui.app.innerHTML.includes('확보한 단서 <b>6 / 6</b>'));
    ui.click('navigate', 'notebook');
    notebookCounts(facts, statements);
    ui.click('navigate', 'submit');
    ui.changeSelection('suspectId', caseData.answer.suspectId);
    ui.submit();

    assert.ok(visible(caseData.ending.title));
    assert.ok(visible('힌트 3단계 확인 · 추리 2회 제출'));
    assert.ok(caseData.answer.explanation.every(visible));
    assert.ok(caseData.ending.timeline.every((item) => visible(item.event)));
    assert.ok(caseData.ending.lies.every((item) => visible(item.reason)));
    assert.ok(!ui.app.innerHTML.includes('id="hint-panel"'));

    ui.click('navigate', 'notebook');
    notebookCounts(facts, statements);
    assert.ok(!visible(caseData.ending.title));
    ui.click('navigate', 'submit');
    assert.ok(visible(caseData.ending.title));
    ui.click('restart-prompt');
    ui.click('restart-cancel');
    assert.ok(visible(caseData.ending.title));
    assert.ok(!ui.app.innerHTML.includes('id="restart-panel"'));
    ui.click('restart-prompt');
    ui.click('restart');

    assert.ok(visible(caseData.subtitle));
    assert.equal(ui.findButton('navigate', 'notebook').disabled, true);
    assert.ok(!ui.app.innerHTML.includes('id="hint-panel"'));
    ui.click('start');
    ui.click('navigate', 'notebook');
    notebookCounts(0, 0);
    ui.click('toggle-hints');
    assert.ok(caseData.hints.every((hint) => !visible(hint)));
    ui.click('toggle-hints');
    ui.click('navigate', 'submit');
    assert.ok(ui.app.innerHTML.includes('제출한 추리 <b>0회</b>'));
    assert.ok(!ui.app.innerHTML.includes('class="submission-feedback"'));
    assert.ok(ui.focusCalls.includes('#main-content'));
    assert.ok(ui.scrollCalls.includes('#hint-panel'));
  } finally {
    if (originalDocument) {
      Object.defineProperty(globalThis, 'document', originalDocument);
    } else {
      delete globalThis.document;
    }

    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow);
    } else {
      delete globalThis.window;
    }
  }
});

test('다섯 사건 선택·새로 로드·초기화 취소·완료 복원이 독립적으로 연결된다', async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const stored = new Map();
  const storage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) };
  let reload = 0;
  const mount = async () => {
    const ui = createDocumentAdapter();
    Object.defineProperty(globalThis, 'document', { configurable: true, value: ui.document });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: ui.window });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    await import(`../src/app.js?reload=${++reload}`);
    return ui;
  };
  try {
    let ui = await mount();
    for (const data of cases) {
      ui.click('new-case', data.id);
      for (const clue of data.clues) {
        ui.click('location', clue.locationId);
        ui.click('inspect', clue.id);
      }
      ui.click('navigate', 'talk');
      const asked = new Set();
      for (let pass = 0; pass < 8; pass++) {
        for (const person of data.suspects) {
          ui.click('person', person.id);
          for (const q of data.questions.filter((q) => q.personId === person.id)) {
            if (!asked.has(q.id) && !ui.findButton('question', q.id).disabled) {
              ui.click('question', q.id);
              asked.add(q.id);
            }
          }
        }
      }
      assert.equal(asked.size, data.questions.length);
      ui.click('toggle-hints');
      ui.click('hint');
      ui.click('toggle-hints');
      ui = await mount();
      assert.ok(ui.app.innerHTML.includes(data.locationName));
      ui.click('navigate', 'submit');
      ui.changeSelection('suspectId', data.answer.suspectId);
      ui.changeSelection('sceneClueId', data.answer.sceneClueId);
      ui.changeSelection('routeClueId', data.answer.routeClueId);
      ui.submit();
      assert.ok(ui.app.innerHTML.includes(data.ending.title));
      ui.click('library');
    }
    assert.equal((ui.app.innerHTML.match(/해설 다시 보기/g) ?? []).length, cases.length);
    const before = [...stored.entries()];
    ui.click('new-case', cases[1].id);
    ui.click('restart-cancel');
    assert.deepEqual([...stored.entries()], before);
    ui.click('new-case', cases[1].id);
    ui.click('restart');
    ui.click('library');
    assert.equal((ui.app.innerHTML.match(/해설 다시 보기/g) ?? []).length, cases.length - 1);
    ui.click('open-case', cases[2].id);
    ui = await mount();
    assert.ok(ui.app.innerHTML.includes(cases[2].ending.title));
  } finally {
    for (const [name, descriptor] of [['document', originalDocument], ['window', originalWindow], ['localStorage', originalStorage]]) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
