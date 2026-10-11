import test from 'node:test';
import assert from 'node:assert/strict';
import { caseData } from '../src/case-data.js';
import {
  askQuestion,
  canAskQuestion,
  createGame,
  discoverClue,
  getNotebook,
  meetSuspect,
  revealHint,
  startGame,
  submitSolution,
} from '../src/game-engine.js';

function askAvailableQuestions(state) {
  let nextState = state;
  let changed;

  do {
    changed = false;

    for (const question of caseData.questions) {
      if (canAskQuestion(nextState, question)) {
        nextState = askQuestion(nextState, caseData, question.id);
        changed = true;
      }
    }
  } while (changed);

  return nextState;
}

function investigate(clueOrder = caseData.clues.map((clue) => clue.id)) {
  let state = startGame(createGame());

  for (const person of caseData.suspects) {
    state = meetSuspect(state, caseData, person.id);
  }

  state = askAvailableQuestions(state);

  for (const id of clueOrder) {
    state = discoverClue(state, caseData, id);
    state = askAvailableQuestions(state);
  }

  return state;
}

function* permutations(items) {
  if (items.length === 0) {
    yield [];
    return;
  }

  for (let index = 0; index < items.length; index += 1) {
    const remaining = items.filter((_, itemIndex) => itemIndex !== index);

    for (const tail of permutations(remaining)) {
      yield [items[index], ...tail];
    }
  }
}

function correctSelection() {
  return {
    suspectId: caseData.answer.suspectId,
    sceneClueId: caseData.answer.sceneClueId,
    routeClueId: caseData.answer.routeClueId,
  };
}

test('사건 자료의 인물·단서 개수와 연결이 유효하다', () => {
  assert.equal(caseData.suspects.length, 3);
  assert.equal(caseData.clues.length, 6);

  const clueIds = new Set(caseData.clues.map((clue) => clue.id));
  const personIds = new Set(caseData.suspects.map((person) => person.id));
  const locationIds = new Set(caseData.locations.map((location) => location.id));
  const initialIds = caseData.suspects.map((person) => `initial-${person.id}`);
  const questionIds = new Set([
    ...initialIds,
    ...caseData.questions.map((question) => question.id),
  ]);

  assert.equal(clueIds.size, 6);
  assert.equal(personIds.size, 3);
  assert.equal(questionIds.size, 3 + caseData.questions.length);

  for (const clue of caseData.clues) {
    assert.ok(locationIds.has(clue.locationId), `단서 장소: ${clue.id}`);
    assert.ok(clue.name && clue.note, `단서 기록: ${clue.id}`);
  }

  for (const person of caseData.suspects) {
    assert.ok(person.name && person.initial, `인물 기본 진술: ${person.id}`);
  }

  for (const question of caseData.questions) {
    assert.ok(personIds.has(question.personId), `질문 인물: ${question.id}`);
    assert.ok(question.label && question.statement, `질문 기록: ${question.id}`);
    assert.ok(Array.isArray(question.response) && question.response.length > 0);

    for (const id of question.requiresClues ?? []) {
      assert.ok(clueIds.has(id), `질문이 요구하는 단서: ${question.id} → ${id}`);
    }

    for (const id of question.requiresQuestions ?? []) {
      assert.ok(questionIds.has(id), `질문이 요구하는 대화: ${question.id} → ${id}`);
    }
  }

  assert.ok(personIds.has(caseData.answer.suspectId));
  assert.ok(clueIds.has(caseData.answer.sceneClueId));
  assert.ok(clueIds.has(caseData.answer.routeClueId));
  assert.ok(caseData.answer.requiredClues.length > 0);
  assert.ok(caseData.answer.requiredQuestions.length > 0);
  assert.ok(caseData.answer.requiredClues.every((id) => clueIds.has(id)));
  assert.ok(caseData.answer.requiredQuestions.every((id) => questionIds.has(id)));
});

test('시작 전에는 조사·대화·힌트·정답 판정을 진행할 수 없다', () => {
  const state = createGame();
  const clueId = caseData.clues[0].id;
  const personId = caseData.suspects[0].id;
  const question = caseData.questions[0];

  assert.equal(discoverClue(state, caseData, clueId), state);
  assert.equal(meetSuspect(state, caseData, personId), state);
  assert.equal(askQuestion(state, caseData, question.id), state);
  assert.equal(canAskQuestion(state, question), false);
  assert.equal(revealHint(state, caseData), state);
  assert.equal(submitSolution(state, caseData, correctSelection()).status, 'incomplete');
  assert.deepEqual(getNotebook(state, caseData), { facts: [], statements: [] });
});

test('720가지 단서 조사 순서에서 필수 질문과 정답에 도달한다', () => {
  let count = 0;

  for (const order of permutations(caseData.clues.map((clue) => clue.id))) {
    const state = investigate(order);
    const result = submitSolution(state, caseData, correctSelection());

    assert.ok(caseData.answer.requiredQuestions.every((id) => state.questionIds.includes(id)));
    assert.equal(state.questionIds.length, caseData.suspects.length + caseData.questions.length);
    assert.equal(result.status, 'correct', `조사 순서: ${order.join(', ')}`);
    assert.equal(result.state.solved, true);
    assert.equal(result.state.attempts, 1);
    assert.equal(state.solved, false);
    assert.equal(state.hintLevel, 0);
    count += 1;
  }

  assert.equal(count, 720);
});

test('단서를 먼저 모두 조사하고 인물을 나중에 만나도 완료할 수 있다', () => {
  let state = startGame(createGame());

  for (const clue of [...caseData.clues].reverse()) {
    state = discoverClue(state, caseData, clue.id);
  }

  for (const person of [...caseData.suspects].reverse()) {
    state = meetSuspect(state, caseData, person.id);
    state = askAvailableQuestions(state);
  }

  assert.equal(submitSolution(state, caseData, correctSelection()).status, 'correct');
});

test('조사·대화의 반복과 존재하지 않는 ID는 기록을 중복시키지 않는다', () => {
  const state = investigate();

  assert.equal(startGame(state), state);

  for (const clue of caseData.clues) {
    assert.equal(discoverClue(state, caseData, clue.id), state);
  }

  for (const person of caseData.suspects) {
    assert.equal(meetSuspect(state, caseData, person.id), state);
  }

  for (const question of caseData.questions) {
    assert.equal(askQuestion(state, caseData, question.id), state);
  }

  assert.equal(discoverClue(state, caseData, 'missing'), state);
  assert.equal(meetSuspect(state, caseData, 'missing'), state);
  assert.equal(askQuestion(state, caseData, 'missing'), state);
  assert.equal(new Set(state.clueIds).size, state.clueIds.length);
  assert.equal(new Set(state.questionIds).size, state.questionIds.length);
  const notebook = getNotebook(state, caseData);

  assert.equal(new Set(notebook.facts.map((fact) => fact.id)).size, notebook.facts.length);
  assert.equal(new Set(notebook.statements.map((item) => item.id)).size, notebook.statements.length);
});

test('확보하지 않은 증거나 앞선 질문 없이 증거 제시를 건너뛸 수 없다', () => {
  const completeState = investigate();
  let checkedClues = 0;
  let checkedQuestions = 0;

  for (const question of caseData.questions) {
    const beforeQuestion = {
      ...completeState,
      questionIds: completeState.questionIds.filter((id) => id !== question.id),
    };

    for (const missingId of question.requiresClues ?? []) {
      const state = {
        ...beforeQuestion,
        clueIds: beforeQuestion.clueIds.filter((id) => id !== missingId),
      };

      assert.equal(canAskQuestion(state, question), false);
      assert.equal(askQuestion(state, caseData, question.id), state);
      checkedClues += 1;
    }

    for (const missingId of question.requiresQuestions ?? []) {
      const state = {
        ...beforeQuestion,
        questionIds: beforeQuestion.questionIds.filter((id) => id !== missingId),
      };

      assert.equal(canAskQuestion(state, question), false);
      assert.equal(askQuestion(state, caseData, question.id), state);
      checkedQuestions += 1;
    }
  }

  assert.ok(checkedClues > 0);
  assert.ok(checkedQuestions > 0);
});

test('정답 조합을 알아도 필요한 단서 또는 질문이 하나라도 빠지면 해결되지 않는다', () => {
  const completeState = investigate();

  for (const missingId of caseData.answer.requiredClues) {
    const state = {
      ...completeState,
      clueIds: completeState.clueIds.filter((id) => id !== missingId),
    };
    const result = submitSolution(state, caseData, correctSelection());

    assert.equal(result.status, 'incomplete');
    assert.equal(result.state, state);
    assert.equal(result.state.attempts, 0);
  }

  for (const missingId of caseData.answer.requiredQuestions) {
    const state = {
      ...completeState,
      questionIds: completeState.questionIds.filter((id) => id !== missingId),
    };
    const result = submitSolution(state, caseData, correctSelection());

    assert.equal(result.status, 'incomplete');
    assert.equal(result.state, state);
  }

  for (const selection of [
    {},
    { ...correctSelection(), suspectId: 'missing' },
    { ...correctSelection(), sceneClueId: 'missing' },
    { ...correctSelection(), routeClueId: 'missing' },
  ]) {
    assert.equal(submitSolution(completeState, caseData, selection).status, 'incomplete');
  }
});

test('108개 제출 조합 중 정확한 범인·현장 증거·동선 근거만 정답이다', () => {
  const state = investigate();
  let correctCount = 0;
  let incorrectCount = 0;

  for (const person of caseData.suspects) {
    for (const sceneClue of caseData.clues) {
      for (const routeClue of caseData.clues) {
        const selection = {
          suspectId: person.id,
          sceneClueId: sceneClue.id,
          routeClueId: routeClue.id,
        };
        const result = submitSolution(state, caseData, selection);

        if (result.status === 'correct') {
          assert.deepEqual(selection, correctSelection());
          correctCount += 1;
        } else {
          assert.equal(result.status, 'incorrect');
          assert.equal(result.state.solved, false);
          assert.equal(result.state.attempts, 1);
          assert.equal(Object.hasOwn(result, 'explanation'), false);
          incorrectCount += 1;
        }
      }
    }
  }

  assert.equal(correctCount, 1);
  assert.equal(incorrectCount, 107);
});

test('오답 뒤 재조사·재제출이 가능하며 원래 상태는 바뀌지 않는다', () => {
  const state = investigate();
  const wrongPerson = caseData.suspects.find((person) => person.id !== caseData.answer.suspectId);
  const incorrect = submitSolution(state, caseData, {
    ...correctSelection(),
    suspectId: wrongPerson.id,
  });

  assert.equal(incorrect.status, 'incorrect');
  assert.equal(state.attempts, 0);
  assert.equal(state.solved, false);
  assert.deepEqual(getNotebook(incorrect.state, caseData), getNotebook(state, caseData));
  const correct = submitSolution(incorrect.state, caseData, correctSelection());

  assert.equal(correct.status, 'correct');
  assert.equal(correct.state.attempts, 2);
});

test('수첩의 사실과 인물별 진술은 별도 기록이며 자동 해석을 추가하지 않는다', () => {
  let state = startGame(createGame());
  state = meetSuspect(state, caseData, caseData.suspects[0].id);
  const initialNotebook = getNotebook(state, caseData);

  assert.equal(initialNotebook.facts.length, 0);
  assert.equal(initialNotebook.statements.length, 1);
  assert.equal(initialNotebook.statements[0].text, caseData.suspects[0].initial);
  assert.equal(initialNotebook.statements[0].personId, caseData.suspects[0].id);

  const notebook = getNotebook(investigate(), caseData);
  const questionFacts = caseData.questions.filter((question) => question.fact);

  assert.deepEqual(Object.keys(notebook), ['facts', 'statements']);
  assert.equal(notebook.facts.length, caseData.clues.length + questionFacts.length);
  assert.equal(notebook.statements.length, caseData.suspects.length + caseData.questions.length);

  for (const clue of caseData.clues) {
    assert.equal(notebook.facts.find((fact) => fact.id === clue.id).text, clue.note);
  }

  for (const question of caseData.questions) {
    const statement = notebook.statements.find((item) => item.id === question.id);

    assert.equal(statement.text, question.statement);
    assert.equal(statement.personId, question.personId);

    if (question.fact) {
      assert.equal(
        notebook.facts.find((fact) => fact.id === `fact-${question.id}`).text,
        question.fact,
      );
    }
  }
});

test('힌트는 명시적으로 요청해야 한 단계씩 나오며 마지막 단계를 넘지 않는다', () => {
  let state = investigate();
  assert.equal(state.hintLevel, 0);

  for (let level = 1; level <= caseData.hints.length; level += 1) {
    const previousState = state;
    state = revealHint(state, caseData);
    assert.equal(state.hintLevel, level);
    assert.equal(previousState.hintLevel, level - 1);
  }

  assert.equal(revealHint(state, caseData), state);
});

test('해결 후 기록을 보존하며 새 게임은 완전히 독립적인 상태로 시작한다', () => {
  const solvedState = submitSolution(investigate(), caseData, correctSelection()).state;

  assert.equal(revealHint(solvedState, caseData), solvedState);
  assert.equal(discoverClue(solvedState, caseData, caseData.clues[0].id), solvedState);
  assert.equal(askQuestion(solvedState, caseData, caseData.questions[0].id), solvedState);
  assert.equal(meetSuspect(solvedState, caseData, caseData.suspects[0].id), solvedState);
  assert.equal(submitSolution(solvedState, caseData, {}).state, solvedState);

  const first = createGame();
  const second = createGame();

  assert.deepEqual(first, {
    started: false,
    clueIds: [],
    questionIds: [],
    hintLevel: 0,
    solved: false,
    attempts: 0,
  });
  assert.notEqual(first.clueIds, second.clueIds);
  assert.notEqual(first.questionIds, second.questionIds);
});
