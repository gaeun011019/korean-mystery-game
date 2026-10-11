export function createGame() {
  return {
    started: false,
    clueIds: [],
    questionIds: [],
    hintLevel: 0,
    solved: false,
    attempts: 0,
  };
}

export function startGame(state) {
  if (state.started) {
    return state;
  }

  return { ...state, started: true };
}

export function discoverClue(state, caseData, id) {
  const clue = caseData.clues.find((item) => item.id === id);

  if (!state.started || state.solved || !clue || state.clueIds.includes(id)) {
    return state;
  }

  return { ...state, clueIds: [...state.clueIds, id] };
}

export function meetSuspect(state, caseData, personId) {
  const person = caseData.suspects.find((item) => item.id === personId);
  const questionId = `initial-${personId}`;

  if (
    !state.started ||
    state.solved ||
    !person ||
    state.questionIds.includes(questionId)
  ) {
    return state;
  }

  return { ...state, questionIds: [...state.questionIds, questionId] };
}

export function canAskQuestion(state, question) {
  if (
    !state.started ||
    state.solved ||
    !question ||
    state.questionIds.includes(question.id)
  ) {
    return false;
  }

  return (
    (question.requiresClues ?? []).every((id) => state.clueIds.includes(id)) &&
    (question.requiresQuestions ?? []).every((id) => state.questionIds.includes(id))
  );
}

export function askQuestion(state, caseData, id) {
  const question = caseData.questions.find((item) => item.id === id);

  if (!canAskQuestion(state, question)) {
    return state;
  }

  return { ...state, questionIds: [...state.questionIds, id] };
}

export function revealHint(state, caseData) {
  if (!state.started || state.solved || state.hintLevel >= caseData.hints.length) {
    return state;
  }

  return { ...state, hintLevel: state.hintLevel + 1 };
}

export function submitSolution(state, caseData, selection = {}) {
  if (state.solved) {
    return {
      state,
      status: 'correct',
      message: '이미 해결한 사건입니다. 수첩과 해설을 다시 읽을 수 있습니다.',
    };
  }

  const answer = caseData.answer;
  const suspectExists = caseData.suspects.some(
    (person) => person.id === selection.suspectId,
  );
  const ownsSelectedClues = [selection.sceneClueId, selection.routeClueId].every(
    (id) => state.clueIds.includes(id) && caseData.clues.some((clue) => clue.id === id),
  );
  const gatheredRequiredClues = answer.requiredClues.every(
    (id) => state.clueIds.includes(id),
  );
  const heardRequiredQuestions = answer.requiredQuestions.every(
    (id) => state.questionIds.includes(id),
  );

  if (
    !state.started ||
    !suspectExists ||
    !ownsSelectedClues ||
    !gatheredRequiredClues ||
    !heardRequiredQuestions
  ) {
    return {
      state,
      status: 'incomplete',
      message: '아직 판단에 필요한 조사가 남아 있습니다. 확보한 단서를 살펴보고, 인물에게 제시한 뒤 세 항목을 모두 선택해 주세요.',
    };
  }

  const correct = (
    selection.suspectId === answer.suspectId &&
    selection.sceneClueId === answer.sceneClueId &&
    selection.routeClueId === answer.routeClueId
  );
  const nextState = {
    ...state,
    attempts: state.attempts + 1,
    solved: correct,
  };

  return {
    state: nextState,
    status: correct ? 'correct' : 'incorrect',
    message: correct
      ? '사건이 해결되었습니다. 당신의 추리를 사건 시간표와 함께 확인해 보세요.'
      : '선택한 인물과 두 근거가 사건 전체를 설명하지 못합니다. 수첩에서 사실과 진술을 다시 비교해 보세요.',
  };
}

export function getNotebook(state, caseData) {
  const facts = caseData.clues
    .filter((clue) => state.clueIds.includes(clue.id))
    .map((clue) => ({
      id: clue.id,
      title: clue.name,
      text: clue.note,
    }));
  const statements = [];

  for (const person of caseData.suspects) {
    if (state.questionIds.includes(`initial-${person.id}`)) {
      statements.push({
        id: `initial-${person.id}`,
        personId: person.id,
        title: '첫 진술',
        text: person.initial,
      });
    }
  }

  for (const question of caseData.questions) {
    if (!state.questionIds.includes(question.id)) {
      continue;
    }

    if (question.fact) {
      facts.push({
        id: `fact-${question.id}`,
        title: question.label,
        text: question.fact,
      });
    }

    if (question.statement) {
      statements.push({
        id: question.id,
        personId: question.personId,
        title: question.label,
        text: question.statement,
      });
    }
  }

  return { facts, statements };
}
