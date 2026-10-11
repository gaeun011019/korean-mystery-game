import test from 'node:test';
import assert from 'node:assert/strict';
import { cases } from '../src/case-data.js';
import { askQuestion, canAskQuestion, createGame, discoverClue, getNotebook, meetSuspect, revealHint, startGame, submitSolution } from '../src/game-engine.js';
import { createSaveStore, SAVE_PREFIX, SAVE_VERSION, validGame } from '../src/save-store.js';

function* permutations(items) {
  if (!items.length) yield [];
  else for (let i = 0; i < items.length; i++) for (const tail of permutations(items.filter((_, j) => i !== j))) yield [items[i], ...tail];
}
function investigate(data, clues = data.clues) {
  let state = startGame(createGame());
  for (const person of data.suspects) state = meetSuspect(state, data, person.id);
  for (const clue of clues) {
    state = discoverClue(state, data, clue.id);
    let changed;
    do {
      changed = false;
      for (const q of data.questions) if (canAskQuestion(state, q)) { state = askQuestion(state, data, q.id); changed = true; }
    } while (changed);
  }
  return state;
}
function store() {
  const values = new Map();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

test('다섯 사건의 고유 ID와 기존 revision·저장 버전을 유지한다', () => {
  assert.equal(cases.length, 5);
  assert.equal(new Set(cases.map((c) => c.id)).size, 5);
  assert.deepEqual(cases.slice(0, 3).map((c) => [c.id, c.revision]), [['the-unsaid-words', 1], ['four-minutes-ahead', 1], ['one-false-record', 1]]);
  assert.equal(SAVE_VERSION, 1);
});

for (const data of cases.slice(3)) {
  test(`${data.title}: 384 조사 경로와 256 제출 조합·필수 조사·질문 연결`, () => {
    let paths = 0;
    for (const locations of permutations(data.locations)) for (let mask = 0; mask < 16; mask++) {
      const order = locations.flatMap((loc, index) => {
        const ids = [...loc.clueIds];
        if (mask & (1 << index)) ids.reverse();
        return ids.map((id) => data.clues.find((c) => c.id === id));
      });
      const state = investigate(data, order);
      assert.equal(submitSolution(state, data, data.answer).status, 'correct');
      assert.ok(validGame(state, data));
      assert.equal(state.questionIds.length, data.suspects.length + data.questions.length);
      paths++;
    }
    assert.equal(paths, 384);
    const state = investigate(data);
    let correct = 0;
    for (const p of data.suspects) for (const scene of data.clues) for (const route of data.clues) {
      const result = submitSolution(state, data, { suspectId: p.id, sceneClueId: scene.id, routeClueId: route.id });
      if (result.status === 'correct') correct++;
      else assert.equal(result.status, 'incorrect');
    }
    assert.equal(correct, 1);
    for (const id of data.answer.requiredClues) assert.equal(submitSolution({ ...state, clueIds: state.clueIds.filter((c) => c !== id) }, data, data.answer).status, 'incomplete');
    for (const id of data.answer.requiredQuestions) assert.equal(submitSolution({ ...state, questionIds: state.questionIds.filter((q) => q !== id) }, data, data.answer).status, 'incomplete');
    assert.equal(new Set(data.clues.map((c) => c.id)).size, 8);
    assert.equal(new Set(data.questions.map((q) => q.id)).size, data.questions.length);
    const ids = new Set([...data.questions.map((q) => q.id), ...data.suspects.map((p) => `initial-${p.id}`)]);
    for (const q of data.questions) {
      assert.ok(data.suspects.some((p) => p.id === q.personId));
      assert.ok(q.requiresClues.every((id) => data.clues.some((c) => c.id === id)));
      assert.ok(q.requiresQuestions.every((id) => ids.has(id)));
    }
  });

  test(`${data.title}: 선택적 관계 대화 없이 핵심 추론으로 제출·단계별 힌트`, () => {
    let state = startGame(createGame());
    for (const p of data.suspects) state = meetSuspect(state, data, p.id);
    for (const id of data.answer.requiredClues) state = discoverClue(state, data, id);
    for (let pass = 0; pass < 10; pass++) for (const q of data.questions) if (data.answer.requiredQuestions.includes(q.id) && canAskQuestion(state, q)) state = askQuestion(state, data, q.id);
    assert.equal(submitSolution(state, data, data.answer).status, 'correct');
    assert.ok(state.questionIds.length < data.suspects.length + data.questions.length);
    assert.equal(state.hintLevel, 0);
    for (let level = 1; level <= 3; level++) { state = revealHint(state, data); assert.equal(state.hintLevel, level); }
    assert.equal(revealHint(state, data), state);
    assert.ok(!getNotebook(state, data).facts.some((f) => f.id.startsWith('fact-')));
    assert.equal(data.estimatedTime, data.number === '004' ? '목표 20–30분' : '목표 25–40분');
  });
}

test('새 보통 사건: 확인 시점 이후 접근과 원본 물품을 교차 검산하면 한 명만 남는다', () => {
  const data = cases[3], logic = data.logic;
  const candidates = logic.visits.filter((v) => v.enter > logic.checkMinute && v.exit < logic.foundMinute);
  assert.deepEqual(candidates.map((v) => v.personId), [logic.expected]);
  assert.equal(logic.custody.personId, logic.expected);
  assert.equal(logic.custody.item, logic.original);
  assert.equal(data.answer.suspectId, logic.expected);
  assert.ok(data.clues.find((c) => c.id === 'sealed-bag').note.includes('L17'));
  assert.ok(data.clues.find((c) => c.id === 'cue-record').note.includes('16:14'));
});

test('새 어려움 사건: 초기 상자 반출 가설은 점검으로 배제되고 앞선 접근과 M4 물증이 일치한다', () => {
  const data = cases[4], logic = data.logic;
  assert.ok(logic.boxAt > logic.copyAt);
  const possible = logic.accesses.filter((a) => a.time > logic.originalAt && a.time < logic.copyAt);
  assert.deepEqual(possible.map((a) => a.personId), [logic.expected]);
  assert.equal(logic.recovered.personId, logic.expected);
  assert.equal(logic.recovered.item, logic.original);
  assert.equal(data.answer.suspectId, logic.expected);
  assert.ok(data.clues.find((c) => c.id === 'direct-check').note.includes('13:09'));
  assert.ok(data.clues.find((c) => c.id === 'tool-video').note.includes('M4'));
});

test('기존 세 사건 저장 원문을 유지하며 새 두 사건 중간 진행·완료·초기화가 분리된다', () => {
  const storage = store();
  const previous = createSaveStore(() => storage);
  for (const data of cases.slice(0, 3)) previous.save(data, submitSolution(investigate(data), data, data.answer).state, { page: 'ending' });
  const oldRecords = cases.slice(0, 3).map((data) => [SAVE_PREFIX + data.id, storage.getItem(SAVE_PREFIX + data.id)]);
  const saves = createSaveStore(() => storage);
  cases.forEach((data) => saves.load(data));
  for (const data of cases.slice(3)) {
    const started = discoverClue(startGame(createGame()), data, data.clues[0].id);
    saves.save(data, started, { page: 'investigate', location: data.clues[0].locationId, clue: data.clues[0].id });
    const reloaded = createSaveStore(() => storage).load(data);
    assert.deepEqual(reloaded.state, started);
    assert.equal(reloaded.view.clue, data.clues[0].id);
    saves.save(data, submitSolution(investigate(data), data, data.answer).state, { page: 'ending' });
    assert.equal(createSaveStore(() => storage).load(data).state.solved, true);
  }
  saves.reset(cases[3]);
  assert.equal(createSaveStore(() => storage).load(cases[3]).state.started, false);
  assert.equal(createSaveStore(() => storage).load(cases[4]).state.solved, true);
  for (const [key, raw] of oldRecords) assert.equal(storage.getItem(key), raw);
});
