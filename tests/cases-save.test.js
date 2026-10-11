import test from 'node:test';
import assert from 'node:assert/strict';
import { cases } from '../src/case-data.js';
import { askQuestion, canAskQuestion, createGame, discoverClue, meetSuspect, startGame, submitSolution } from '../src/game-engine.js';
import { createSaveStore, SAVE_PREFIX, SAVE_VERSION, validGame } from '../src/save-store.js';

function memoryStorage() {
  const data = new Map();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) };
}

function investigate(data, order = data.clues) {
  let state = startGame(createGame());
  for (const person of data.suspects) state = meetSuspect(state, data, person.id);
  for (const clue of order) {
    state = discoverClue(state, data, clue.id);
    let changed;
    do {
      changed = false;
      for (const question of data.questions) {
        if (canAskQuestion(state, question)) {
          state = askQuestion(state, data, question.id);
          changed = true;
        }
      }
    } while (changed);
  }
  return state;
}

function* permutations(items) {
  if (!items.length) yield [];
  else for (let index = 0; index < items.length; index++) {
    for (const tail of permutations(items.filter((_, i) => i !== index))) yield [items[index], ...tail];
  }
}

for (const data of cases.slice(0, 3)) {
  test(`${data.difficulty}: 단서 720순서와 정답 유일성·필수 질문 누락·중복`, () => {
    for (const order of permutations(data.clues)) {
      const state = investigate(data, order);
      assert.equal(submitSolution(state, data, data.answer).status, 'correct');
      assert.ok(validGame(state, data));
      assert.equal(state.questionIds.length, data.questions.length + data.suspects.length);
      assert.equal(discoverClue(state, data, order[0].id), state);
    }
    const state = investigate(data);
    let correct = 0;
    for (const person of data.suspects) for (const scene of data.clues) for (const route of data.clues) {
      const result = submitSolution(state, data, { suspectId: person.id, sceneClueId: scene.id, routeClueId: route.id });
      if (result.status === 'correct') correct++;
      else assert.equal(result.status, 'incorrect');
    }
    assert.equal(correct, 1);
    for (const id of data.answer.requiredQuestions) {
      assert.equal(submitSolution({ ...state, questionIds: state.questionIds.filter((q) => q !== id) }, data, data.answer).status, 'incomplete');
    }
    for (const id of data.answer.requiredClues) {
      assert.equal(submitSolution({ ...state, clueIds: state.clueIds.filter((q) => q !== id) }, data, data.answer).status, 'incomplete');
    }
    const questionIds = new Set([...data.suspects.map((s) => `initial-${s.id}`), ...data.questions.map((q) => q.id)]);
    for (const q of data.questions) {
      assert.ok(data.suspects.some((s) => s.id === q.personId));
      assert.ok(q.requiresClues.every((id) => data.clues.some((c) => c.id === id)));
      assert.ok(q.requiresQuestions.every((id) => questionIds.has(id)));
    }
  });
}

test('새 사건의 정답은 고정 선택값뿐 아니라 공개 논리 조건으로 검산한다', () => {
  const medium = cases[1].logic;
  const actual = medium.displayMinute - medium.offsetMinutes;
  assert.equal(actual, medium.expectedMinute);
  assert.ok(actual > medium.window[0] && actual < medium.window[1]);
  const hard = cases[2].logic;
  const possibilities = [...permutations(hard.keys)].filter(([ara, boram]) => {
    const truths = [ara !== 'B', ara === 'C', boram === 'A'];
    return truths.filter(Boolean).length === hard.trueCount;
  });
  assert.deepEqual(possibilities, [hard.expected]);
  assert.equal(hard.expected[cases[2].suspects.findIndex((s) => s.id === cases[2].answer.suspectId)], hard.incidentKey);
});

test('새 저장소 인스턴스에서 사건별 진행·화면·완료를 복원하고 해당 사건만 초기화', () => {
  const storage = memoryStorage();
  const first = createSaveStore(() => storage);
  for (const data of cases) {
    const state = submitSolution(investigate(data), data, data.answer).state;
    assert.ok(first.save(data, state, { page: 'ending' }));
  }
  const second = createSaveStore(() => storage);
  for (const data of cases) {
    assert.equal(second.load(data).state.solved, true);
    assert.equal(second.load(data).view.page, 'ending');
  }
  second.reset(cases[1]);
  const third = createSaveStore(() => storage);
  assert.equal(third.load(cases[0]).state.solved, true);
  assert.equal(third.load(cases[1]).state.started, false);
  assert.equal(third.load(cases[2]).state.solved, true);
});

test('손상·이전 버전·다른 사건 저장을 보존하고 확인한 초기화만 교체', () => {
  const data = cases[0];
  const storage = memoryStorage();
  for (const raw of ['{broken', JSON.stringify({ version: 0 }), JSON.stringify({ version: SAVE_VERSION, revision: data.revision, caseId: cases[1].id, state: investigate(data) })]) {
    storage.setItem(SAVE_PREFIX + data.id, raw);
    const saves = createSaveStore(() => storage);
    assert.ok(['damaged', 'incompatible'].includes(saves.load(data).status));
    assert.equal(saves.save(data, startGame(createGame()), {}), false);
    assert.equal(storage.getItem(SAVE_PREFIX + data.id), raw);
    saves.reset(data);
    assert.equal(createSaveStore(() => storage).load(data).status, 'saved');
  }
});

test('저장 권한·읽기·쓰기 실패에도 진행을 유지하고 재시도 성공 후 안내를 해제', () => {
  const storage = memoryStorage();
  let failure = true;
  const saves = createSaveStore(() => {
    if (failure) throw new Error('blocked');
    return storage;
  });
  const data = cases[0];
  const state = investigate(data);
  assert.equal(saves.load(data).status, 'unavailable');
  assert.equal(saves.save(data, state, {}), false);
  assert.equal(saves.load(data).state.clueIds.length, 6);
  assert.match(saves.notice, /이 탭/);
  failure = false;
  assert.equal(saves.save(data, state, { page: 'notebook' }), true);
  assert.equal(saves.notice, '');
  assert.equal(createSaveStore(() => storage).load(data).view.page, 'notebook');
  const quota = createSaveStore(() => ({ getItem: () => null, setItem: () => { throw new Error('quota'); } }));
  assert.equal(quota.save(data, state, {}), false);
  assert.match(quota.notice, /남은 공간/);
});

test('저장 진행의 알 수 없는 ID·순환/선행 누락·위조 완료·잘못된 숫자를 거부', () => {
  const data = cases[0];
  const state = investigate(data);
  for (const invalid of [
    { ...state, clueIds: ['unknown'] },
    { ...state, clueIds: [...state.clueIds, state.clueIds[0]] },
    { ...state, questionIds: [...state.questionIds].reverse() },
    { ...state, solved: true, attempts: 0 },
    { ...state, hintLevel: 99 },
    { ...state, attempts: -1 },
    { ...state, started: false },
  ]) assert.equal(validGame(invalid, data), false);
});
