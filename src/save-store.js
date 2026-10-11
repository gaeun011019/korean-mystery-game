import { createGame } from './game-engine.js';

export const SAVE_VERSION = 1;
export const SAVE_PREFIX = 'case-notebook:save:';
const activeKey = 'case-notebook:active';

// 저장된 값은 믿지 않는다. 사건의 ID와 선행 조사 조건까지 확인한다.
export function validGame(value, data) {
  if (!value || typeof value !== 'object') return false;
  const { started, solved, clueIds, questionIds, hintLevel, attempts } = value;
  const initialIds = data.suspects.map((person) => `initial-${person.id}`);
  const knownQuestions = [...initialIds, ...data.questions.map((question) => question.id)];
  const validIds = (ids, known) => Array.isArray(ids)
    && ids.every((id) => typeof id === 'string' && known.includes(id))
    && new Set(ids).size === ids.length;

  if (typeof started !== 'boolean' || typeof solved !== 'boolean'
    || !validIds(clueIds, data.clues.map((clue) => clue.id))
    || !validIds(questionIds, knownQuestions)
    || !Number.isSafeInteger(hintLevel) || hintLevel < 0 || hintLevel > data.hints.length
    || !Number.isSafeInteger(attempts) || attempts < 0) return false;
  if (!started && (solved || clueIds.length || questionIds.length || hintLevel || attempts)) return false;

  // 저장 순서를 이용해 선행 질문 없는 답변과 순환된 위조 진행을 막는다.
  const seen = new Set();
  for (const id of questionIds) {
    if (!initialIds.includes(id)) {
      const question = data.questions.find((item) => item.id === id);
      if (!question.requiresClues.every((clueId) => clueIds.includes(clueId))
        || !question.requiresQuestions.every((questionId) => seen.has(questionId))) return false;
    }
    seen.add(id);
  }
  const complete = data.answer.requiredClues.every((id) => clueIds.includes(id))
    && data.answer.requiredQuestions.every((id) => questionIds.includes(id));
  return (!solved || (complete && attempts > 0)) && (!attempts || complete);
}

export function normalizeView(view, state, data) {
  const safe = view && typeof view === 'object' ? view : {};
  const has = (items, id) => items.some((item) => item.id === id);
  const person = has(data.suspects, safe.person) ? safe.person : data.suspects[0].id;
  const pages = ['overview', 'investigate', 'talk', 'notebook', 'submit', 'ending'];
  let page = pages.includes(safe.page) ? safe.page : 'overview';
  if (!state.started) page = 'overview';
  if (page === 'ending' && !state.solved) page = 'submit';
  if (page === 'submit' && state.solved) page = 'ending';
  const selection = safe.solution ?? {};
  return {
    page,
    location: has(data.locations, safe.location) ? safe.location : data.locations[0].id,
    person,
    clue: state.clueIds.includes(safe.clue) ? safe.clue : null,
    question: state.questionIds.includes(safe.question)
      && data.questions.some((item) => item.id === safe.question && item.personId === person) ? safe.question : null,
    solution: {
      suspectId: has(data.suspects, selection.suspectId) ? selection.suspectId : '',
      sceneClueId: state.clueIds.includes(selection.sceneClueId) ? selection.sceneClueId : '',
      routeClueId: state.clueIds.includes(selection.routeClueId) ? selection.routeClueId : '',
    },
  };
}

export function createSaveStore(getStorage = () => globalThis.localStorage) {
  const cache = new Map();
  const blocked = new Set();
  let notice = '';
  const failure = '브라우저 저장을 사용할 수 없습니다. 지금은 이 탭에서만 진행됩니다. 사이트 저장 권한·남은 공간을 확인하고 저장을 다시 시도하세요.';

  function load(data) {
    if (cache.has(data.id)) return cache.get(data.id);
    let result = { state: createGame(), view: {}, status: 'empty' };
    try {
      const raw = getStorage().getItem(SAVE_PREFIX + data.id);
      if (raw !== null) {
        let saved;
        try { saved = JSON.parse(raw); } catch { saved = null; }
        const compatible = saved?.version === SAVE_VERSION && saved?.revision === data.revision;
        if (compatible && saved.caseId === data.id && validGame(saved.state, data)) {
          const state = { ...createGame(), ...saved.state };
          result = { state, view: normalizeView(saved.view, state, data), status: 'saved' };
        } else {
          blocked.add(data.id);
          result.status = saved && !compatible ? 'incompatible' : 'damaged';
        }
      }
    } catch { notice = failure; result.status = 'unavailable'; }
    cache.set(data.id, result);
    return result;
  }

  function save(data, state, view) {
    const prior = load(data);
    cache.set(data.id, { state, view, status: prior.status });
    if (blocked.has(data.id)) return false;
    try {
      getStorage().setItem(SAVE_PREFIX + data.id, JSON.stringify({
        version: SAVE_VERSION, revision: data.revision, caseId: data.id,
        state, view: normalizeView(view, state, data),
      }));
      cache.set(data.id, { state, view, status: 'saved' });
      notice = '';
      return true;
    } catch { notice = failure; return false; }
  }

  return {
    load, save,
    reset(data) {
      // 호출 전 화면에서 명시적으로 확인한다. 다른 사건 키는 건드리지 않는다.
      blocked.delete(data.id);
      const state = createGame();
      save(data, state, {});
      return state;
    },
    get notice() { return notice; },
    active() {
      try { return getStorage().getItem(activeKey); } catch { notice = failure; return null; }
    },
    setActive(id) {
      try {
        if (id) getStorage().setItem(activeKey, id);
        else getStorage().removeItem(activeKey);
      } catch { notice = failure; }
    },
  };
}
