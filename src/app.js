import { cases } from './case-data.js';
import { createSaveStore, normalizeView } from './save-store.js';
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
} from './game-engine.js';

const app = document.querySelector('#app');
const saves = createSaveStore();
let caseData = cases[0];
let library = true;
let restartCaseId = null;
for (const data of cases) saves.load(data);
const navigation = [
  { id: 'overview', number: '01', label: '사건 개요' },
  { id: 'investigate', number: '02', label: '현장 조사' },
  { id: 'talk', number: '03', label: '인물 대화' },
  { id: 'notebook', number: '04', label: '탐정 수첩' },
  { id: 'submit', number: '05', label: '추리 제출' },
];

let game = createGame();
let page = 'overview';
let selectedLocation = caseData.locations[0].id;
let selectedClue = null;
let selectedPerson = caseData.suspects[0].id;
let selectedQuestion = null;
let showHints = false;
let showRestart = false;
let feedback = null;
let solution = { suspectId: '', sceneClueId: '', routeClueId: '' };

function currentView() {
  return { page, location: selectedLocation, clue: selectedClue, person: selectedPerson, question: selectedQuestion, solution };
}

function persist() {
  if (!library) saves.save(caseData, game, currentView());
}

function openCase(id) {
  const data = cases.find((item) => item.id === id);
  if (!data) return;
  caseData = data;
  const saved = saves.load(data);
  game = saved.state;
  const view = normalizeView(saved.view, game, data);
  page = view.page;
  selectedLocation = view.location;
  selectedClue = view.clue;
  selectedPerson = view.person;
  selectedQuestion = view.question;
  solution = view.solution;
  showHints = false;
  showRestart = false;
  restartCaseId = null;
  feedback = null;
  library = false;
  if (page === 'talk' && game.started && !game.solved) game = meetSuspect(game, caseData, selectedPerson);
  saves.setActive(id);
}

function saveNotice() {
  const status = saves.load(caseData).status;
  const incompatible = status === 'damaged' || status === 'incompatible';
  return `${saves.notice ? `<div class="save-warning" role="status"><p>${escapeHtml(saves.notice)}</p>${actionButton('저장 다시 시도', 'retry-save', '', 'button secondary')}</div>` : ''}
    ${!library && incompatible ? `<div class="save-warning" role="status"><p>이 사건의 저장 기록이 ${status === 'damaged' ? '손상되어' : '이전 또는 다른 버전이라'} 복원하지 못했습니다. 원본 기록은 보존했습니다. 새 게임을 확인하면 이 사건의 기록만 교체합니다.</p>${actionButton('이 사건 새 게임', 'new-case', caseData.id, 'button secondary')}</div>` : ''}`;
}

function renderLibrary() {
  document.title = '사건 수첩 · 사건 선택';
  return `<main id="main-content" class="case-library" tabindex="-1">
    ${eyebrow(`THE CASE NOTEBOOK · ${cases.length}개의 사건`)}
    <h1>오늘 펼칠 사건 수첩</h1>
    <p>어느 사건부터 시작해도 좋습니다. 쉬움부터 차례로 새로운 추론을 연습할 수도 있어요.</p>
    ${saveNotice()}
    <div class="case-grid">${cases.map((data) => {
      const record = saves.load(data);
      const bad = ['damaged', 'incompatible'].includes(record.status);
      const state = record.state;
      const status = bad ? '저장 확인 필요' : state.solved ? '완료' : state.started ? '조사 중' : '새 사건';
      return `<article class="case-card">
        <div class="paper-topline"><span>CASE ${data.number}</span><span>${data.difficulty}</span></div>
        <h2>${escapeHtml(data.title)}</h2><p>${escapeHtml(data.subtitle)}</p>
        <p>${escapeHtml(data.challenge)}</p>
        <p class="small-note">${escapeHtml(data.estimatedTime)} · 단서 ${data.clues.length}개<br />${status}${state.started ? ` · 확보 ${state.clueIds.length}/${data.clues.length}` : ''}</p>
        ${actionButton(state.solved ? '해설 다시 보기' : state.started ? '이어하기' : '사건 살펴보기', 'open-case', data.id, 'button primary')}
        ${actionButton(state.started || bad ? '새 게임' : '새 게임 시작', 'new-case', data.id, 'text-button')}
      </article>`;
    }).join('')}</div>
    <p class="storage-help">진행은 같은 브라우저·기기·사이트 주소에 자동 저장됩니다. 시크릿 모드 종료나 사이트 데이터 삭제 시 사라질 수 있습니다. localhost와 127.0.0.1은 서로 다른 저장 공간입니다. 표시 시간은 실측이 아닌 기획 추정이며, 읽는 속도·재검토·힌트 사용에 따라 달라집니다.</p>
    ${showRestart ? renderRestart() : ''}
  </main>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function paragraphs(lines, className = '') {
  return lines.map((line) => `<p class="${className}">${escapeHtml(line)}</p>`).join('');
}

function eyebrow(text) {
  return `<p class="eyebrow">${escapeHtml(text)}</p>`;
}

function actionButton(label, action, value = '', className = 'button') {
  return `<button class="${className}" data-action="${action}" data-value="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
}

function render() {
  if (library) {
    app.innerHTML = renderLibrary();
    return;
  }
  document.title = `${caseData.title} · 사건 수첩`;
  const notebook = getNotebook(game, caseData);
  const activeLabel = page === 'ending' ? '사건 해설' : navigation.find((item) => item.id === page).label;

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" aria-label="사건 탐색">
        <a class="brand" href="#" data-action="navigate" data-value="overview">
          <span class="brand-mark" aria-hidden="true">冊</span>
          <span>사건 수첩<small>THE CASE NOTEBOOK</small></span>
        </a>
        ${actionButton('← 사건 선택', 'library', '', 'text-button')}
        <div class="case-label">CASE FILE <span>${caseData.number} · ${caseData.difficulty}</span></div>
        <p class="sidebar-title">${escapeHtml(caseData.title).replace(' ', '<br />')}</p>
        <div class="sidebar-rule"></div>
        <nav aria-label="게임 메뉴">
          ${navigation.map((item) => `
            <button
              class="nav-item ${page === item.id || (page === 'ending' && item.id === 'submit') ? 'active' : ''}"
              data-action="navigate"
              data-value="${item.id}"
              ${!game.started && item.id !== 'overview' ? 'disabled' : ''}
              ${page === item.id || (page === 'ending' && item.id === 'submit') ? 'aria-current="page"' : ''}
            >
              <span class="nav-number">${item.number}</span>
              <span>${item.label}</span>
              ${item.id === 'notebook' ? `<span class="nav-count">${notebook.facts.length + notebook.statements.length}</span>` : ''}
            </button>
          `).join('')}
        </nav>
        <div class="sidebar-bottom">
          <p class="sidebar-caption">작은 단서에도<br />각자의 이야기가 있다.</p>
          ${actionButton('도움이 필요할 때', 'toggle-hints', '', 'hint-toggle')}
          <p class="session-note">진행은 이 브라우저에 자동 저장됩니다.<br />같은 기기·사이트 주소에서 이어하세요.</p>
          ${game.started ? actionButton('새 사건 수첩 열기', 'restart-prompt', '', 'restart-link') : ''}
        </div>
      </aside>
      <main id="main-content" tabindex="-1">
        <header class="topbar">
          <span>${escapeHtml(caseData.locationName)} <span class="topbar-divider">/</span> ${activeLabel}</span>
          <span class="status">
            <span class="status-dot"></span>
            ${game.solved ? '조사 완료' : game.started ? '조사 중' : '아직 펼치지 않은 사건'}
          </span>
        </header>
        <div class="page-content">
          ${saveNotice()}
          ${page === 'ending' ? renderEnding() : renderPage()}
          ${showHints ? renderHints() : ''}
          ${showRestart ? renderRestart() : ''}
        </div>
        <footer class="page-footer">
          <span>${escapeHtml(caseData.locationName)} 사건 기록</span>
          <span>CASE ${caseData.number} · ${game.solved ? 'CLOSED' : 'OPEN'}</span>
        </footer>
      </main>
    </div>
  `;
}

function renderPage() {
  switch (page) {
    case 'investigate':
      return renderInvestigation();
    case 'talk':
      return renderConversation();
    case 'notebook':
      return renderNotebook();
    case 'submit':
      return renderSubmission();
    default:
      return renderOverview();
  }
}

function renderOverview() {
  return `
    <section class="overview-hero" aria-labelledby="page-title">
      <div class="hero-copy">
        ${eyebrow(`${caseData.difficulty} · ${caseData.setting}`)}
        <h1 id="page-title">${escapeHtml(caseData.title).replace(' ', '<br />')}</h1>
        <p class="hero-subtitle">${escapeHtml(caseData.subtitle)}</p>
        <div class="hero-tags"><span>1인 추리</span><span>${caseData.estimatedTime}</span><span>용의자 ${caseData.suspects.length}명</span></div>
      </div>
      <div class="cover-art" aria-hidden="true">
        <div class="art-orbit"></div>
        <div class="letter-paper">
          <span>남겨진 기록을</span>
          <span>당신의 추리로 잇다.</span>
          <i></i><i></i><i></i>
        </div>
        <div class="envelope"><div class="wax-seal">言</div></div>
        <span class="art-caption">THE WORDS LEFT UNSAID</span>
      </div>
    </section>
    <section class="intro-paper">
      <div class="section-number">PROLOGUE <span>00</span></div>
      <div class="intro-text">
        ${paragraphs(caseData.intro)}
        <div class="start-row">
          ${actionButton(game.started ? '조사 이어가기 →' : '사건 수첩 펼치기 →', 'start', '', 'button primary')}
          <span>시간 제한 없이, 당신의 속도로.<br />진행은 이 브라우저에 자동 저장됩니다.</span>
        </div>
      </div>
    </section>
    <section class="overview-bottom">
      <div>
        ${eyebrow('조사에 앞서')}
        <h2>진술을 듣고, 흔적을 읽으세요.</h2>
        <p>장소와 인물은 자유롭게 오갈 수 있습니다. 발견한 증거와 들은 말은 수첩에 따로 기록됩니다. 결론은 당신의 몫입니다.</p>
      </div>
      <div class="briefing">
        <h3>사건의 기본 기록</h3>
        <p><strong>사건 대상 ${escapeHtml(caseData.victim.name)}</strong> · ${escapeHtml(caseData.victim.description)}</p>
        ${paragraphs(caseData.briefing)}
      </div>
    </section>
  `;
}

function pageHeading(kicker, title, description, detail = '') {
  return `
    <div class="page-heading">
      <div>
        ${eyebrow(kicker)}
        <h1 id="page-title">${title}</h1>
        <p>${description}</p>
      </div>
      ${detail ? `<span class="heading-detail">${detail}</span>` : ''}
    </div>
  `;
}

function renderInvestigation() {
  const location = caseData.locations.find((item) => item.id === selectedLocation);
  const clue = caseData.clues.find((item) => item.id === selectedClue);
  const locationClues = caseData.clues.filter((item) => item.locationId === location.id);

  return `
    ${pageHeading('FIELD NOTES · 현장 기록', '남겨진 흔적', '장소를 선택한 뒤 물건을 자세히 살펴보세요.', `확보한 단서 <b>${game.clueIds.length} / ${caseData.clues.length}</b>`)}
    <div class="location-tabs" role="group" aria-label="조사 장소">
      ${caseData.locations.map((item, index) => `
        <button
          class="location-tab ${item.id === location.id ? 'selected' : ''}"
          data-action="location"
          data-value="${item.id}"
          aria-pressed="${item.id === location.id}"
        >
          <span class="location-index">0${index + 1}</span>
          <span>${escapeHtml(item.name)}</span>
          <span class="location-count">${item.clueIds.filter((id) => game.clueIds.includes(id)).length} / ${item.clueIds.length}</span>
        </button>
      `).join('')}
    </div>
    <div class="investigation-layout">
      <section class="room-panel">
        ${eyebrow('현재 조사 장소')}
        <h2>${escapeHtml(location.name)}</h2>
        <p>${escapeHtml(location.description)}</p>
        <div class="object-list" aria-label="조사할 물건">
          ${locationClues.map((item, index) => `
            <button class="object-button ${item.id === selectedClue ? 'selected' : ''}" data-action="inspect" data-value="${item.id}">
              <span class="object-number">${String(index + 1).padStart(2, '0')}</span>
              <span>${escapeHtml(item.objectLabel)}<small>${game.clueIds.includes(item.id) ? '수첩에 기록됨 · 다시 살펴보기' : '자세히 살펴보기'}</small></span>
              <span aria-hidden="true">↗</span>
            </button>
          `).join('')}
        </div>
        <p class="small-note">물건은 언제든 다시 살펴볼 수 있습니다.<br />같은 기록은 수첩에 한 번만 남습니다.</p>
      </section>
      <section class="evidence-paper" aria-live="polite" aria-label="조사 내용">
        ${clue ? `
          <div class="paper-topline"><span>OBSERVATION</span><span>증거 ${String(caseData.clues.indexOf(clue) + 1).padStart(2, '0')}</span></div>
          <h2>${escapeHtml(clue.name)}</h2>
          ${paragraphs(clue.description)}
          <div class="recorded-note"><span aria-hidden="true">✓</span> 관찰한 사실을 수첩에 기록했습니다.</div>
          ${actionButton('인물에게 증거 제시하기 →', 'navigate', 'talk', 'text-button')}
        ` : `
          <div class="empty-evidence">
            <span class="empty-symbol" aria-hidden="true">⌕</span>
            <h2>작은 흔적부터 천천히</h2>
            <p>왼쪽에서 물건을 선택하면<br />자세한 관찰 내용을 읽을 수 있습니다.</p>
            <span class="empty-dots">· · ·</span>
          </div>
        `}
      </section>
    </div>
  `;
}

function renderConversation() {
  const person = caseData.suspects.find((item) => item.id === selectedPerson);
  const question = caseData.questions.find((item) => item.id === selectedQuestion);
  const questions = caseData.questions.filter((item) => item.personId === person.id);
  const asked = (item) => game.questionIds.includes(item.id);

  return `
    ${pageHeading('INTERVIEWS · 인물 기록', '그들이 기억하는 밤', '이야기를 듣고, 확보한 증거를 제시해 보세요.')}
    <div class="person-tabs" role="group" aria-label="대화할 인물">
      ${caseData.suspects.map((item, index) => `
        <button
          class="person-tab ${item.id === person.id ? 'selected' : ''}"
          data-action="person"
          data-value="${item.id}"
          aria-pressed="${item.id === person.id}"
        >
          <span class="person-monogram" aria-hidden="true">${escapeHtml(item.name.slice(-2, -1))}</span>
          <span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.role)}</small></span>
          <span class="person-index">0${index + 1}</span>
        </button>
      `).join('')}
    </div>
    <div class="conversation-layout">
      <section class="interview-paper" aria-live="polite" aria-label="인물의 답변">
        <div class="paper-topline"><span>STATEMENT</span><span>${escapeHtml(person.name)}의 진술</span></div>
        <p class="person-description">${escapeHtml(person.description)}</p>
        <h2>${question ? escapeHtml(question.label) : '그날 밤에 대해'}</h2>
        <div class="spoken-text">${paragraphs(question ? question.response : [person.initial])}</div>
        ${question?.fact ? `
          <div class="observation-note">
            <h3>탐정의 직접 관찰</h3>
            <p>${escapeHtml(question.fact)}</p>
          </div>
        ` : ''}
        <div class="recorded-note">진술은 발언자의 말로 수첩에 기록됩니다.</div>
      </section>
      <section class="question-panel">
        ${eyebrow('질문과 증거 제시')}
        ${actionButton('처음 들은 이야기 다시 읽기', 'initial', person.id, 'question-button')}
        ${questions.map((item) => {
          const available = canAskQuestion(game, item) || asked(item);
          const missingClues = item.requiresClues.filter((id) => !game.clueIds.includes(id));
          const requirement = missingClues.length
            ? '현장에서 관련 증거를 먼저 확보하세요.'
            : '앞선 질문으로 이야기를 더 들어보세요.';

          return `
            <button
              class="question-button ${item.id === selectedQuestion ? 'selected' : ''}"
              data-action="question"
              data-value="${item.id}"
              ${available ? '' : 'disabled'}
            >
              <span>${available ? escapeHtml(item.label) : '아직 이어지지 않은 질문'}</span>
              <small>${asked(item) ? '기록됨 · 다시 읽기' : available ? (item.requiresClues.length ? '증거 제시' : '질문하기') : requirement}</small>
            </button>
          `;
        }).join('')}
        <p class="small-note">제시할 수 있는 증거는 직접 확보한 것뿐입니다. 조사를 마친 뒤 다시 찾아와도 좋습니다.</p>
      </section>
    </div>
  `;
}

function renderNotebook() {
  const notebook = getNotebook(game, caseData);

  function records(items, type) {
    if (!items.length) {
      return `<p class="empty-record">${type === 'fact' ? '현장에서 물건을 살펴보면 관찰한 사실이 이곳에 남습니다.' : '인물에게 말을 걸면 그들의 진술이 이곳에 남습니다.'}</p>`;
    }

    return items.map((item, index) => {
      const person = caseData.suspects.find((suspect) => suspect.id === item.personId);
      const source = type === 'fact' ? '관찰' : `${person.name}의 말`;

      return `
        <article class="notebook-entry">
          <div class="entry-label">${escapeHtml(source)} · ${String(index + 1).padStart(2, '0')}</div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.text)}</p>
        </article>
      `;
    }).join('');
  }

  return `
    ${pageHeading('DETECTIVE’S NOTES · 탐정 수첩', '사실과 말 사이', '같은 밤을 설명하는 기록들을 나란히 읽어보세요.')}
    <div class="notebook-spread">
      <section class="notebook-page">
        <div class="notebook-heading">
          <h2>관찰한 사실</h2><span>${notebook.facts.length}개의 기록</span>
        </div>
        ${records(notebook.facts, 'fact')}
      </section>
      <section class="notebook-page">
        <div class="notebook-heading">
          <h2>인물의 진술</h2><span>${notebook.statements.length}개의 기록</span>
        </div>
        ${records(notebook.statements, 'statement')}
      </section>
    </div>
  `;
}

function evidenceOptions(selected) {
  return caseData.clues.filter((clue) => game.clueIds.includes(clue.id)).map((clue) => `
    <option value="${clue.id}" ${selected === clue.id ? 'selected' : ''}>${escapeHtml(clue.name)}</option>
  `).join('');
}

function renderSubmission() {
  return `
    ${pageHeading('YOUR DEDUCTION · 마지막 기록', '당신의 추리를 들려주세요.', caseData.submission?.description ?? '누가, 어떤 흔적을 남겼으며, 다른 두 사람은 어디에 있었나요?')}
    <div class="submission-layout">
      <form id="solution-form" class="submission-paper">
        <div class="paper-topline"><span>FINAL STATEMENT</span><span>추리 제출서</span></div>
        <label for="suspect"><span class="form-number">01</span> 범인으로 지목할 인물</label>
        <select id="suspect" name="suspectId" required>
          <option value="">인물을 선택하세요</option>
          ${caseData.suspects.map((person) => `
            <option value="${person.id}" ${solution.suspectId === person.id ? 'selected' : ''}>
              ${escapeHtml(person.name)}
            </option>
          `).join('')}
        </select>
        <label for="scene"><span class="form-number">02</span> ${caseData.submission?.sceneLabel ?? '그 인물의 진술을 검토할 현장 증거'}</label>
        <select id="scene" name="sceneClueId" required>
          <option value="">확보한 현장 증거를 선택하세요</option>
          ${evidenceOptions(solution.sceneClueId)}
        </select>
        <label for="route"><span class="form-number">03</span> ${caseData.submission?.routeLabel ?? '다른 두 사람의 동선을 확인한 근거'}</label>
        <select id="route" name="routeClueId" required>
          <option value="">판단에 사용한 근거를 선택하세요</option>
          ${evidenceOptions(solution.routeClueId)}
        </select>
        <p class="form-note">물건의 발견뿐 아니라, 관련 증거를 제시해 시간과 동선을 확인해야 합니다. 오답이어도 다시 조사할 수 있습니다.</p>
        <button class="button primary" type="submit">이 추리로 제출하기 →</button>
        ${feedback ? `
          <div class="submission-feedback" role="status">
            <strong>${feedback.status === 'incomplete'
              ? '조사를 조금 더 이어가세요.'
              : '이 설명만으로는 사건이 완성되지 않습니다.'}</strong>
            <p>${escapeHtml(feedback.message)}</p>
            ${actionButton('현장으로 돌아가기', 'navigate', 'investigate', 'text-button')}
          </div>
        ` : ''}
      </form>
      <aside class="submission-guide">
        <span class="guide-quote" aria-hidden="true">“</span>
        <h2>비밀이 있다는 것과<br />범인이라는 것은<br />같은 말이 아니다.</h2>
        <p>그날의 말과 행동을 현장의 흔적에 비추어 보세요. 무엇이 설명되고, 무엇이 남아 있나요?</p>
        ${actionButton('수첩 다시 읽기 ↗', 'navigate', 'notebook', 'text-button')}
        <div class="submission-count">확보한 단서 <b>${game.clueIds.length} / ${caseData.clues.length}</b><br />제출한 추리 <b>${game.attempts}회</b></div>
      </aside>
    </div>
  `;
}

function renderHints() {
  let hintStatus = '모든 힌트를 확인했습니다.';
  if (!game.started) {
    hintStatus = '사건 수첩을 펼친 뒤 힌트를 볼 수 있습니다.';
  } else if (game.solved) {
    hintStatus = '해결한 사건입니다. 추리 제출 메뉴에서 해설을 다시 읽을 수 있습니다.';
  }

  const canRevealHint = game.started && !game.solved && game.hintLevel < caseData.hints.length;

  return `
    <section id="hint-panel" class="hint-panel" aria-labelledby="hint-title">
      <div class="hint-heading">
        <div>${eyebrow('도움이 필요할 때만')}<h2 id="hint-title">접어 둔 힌트</h2></div>
        ${actionButton('닫기', 'toggle-hints', '', 'text-button')}
      </div>
      <p>다음 힌트를 누를 때마다 조금 더 구체적인 내용을 보여줍니다. 점수나 시간에 불이익은 없습니다.</p>
      ${caseData.hints.slice(0, game.hintLevel).map((hint, index) => `
        <div class="hint-record">
          <span>힌트 ${index + 1}</span>
          <p>${escapeHtml(hint)}</p>
        </div>
      `).join('')}
      ${canRevealHint
        ? actionButton(`${game.hintLevel + 1}단계 힌트 보기`, 'hint', '', 'button secondary')
        : `<p class="small-note">${hintStatus}</p>`}
    </section>
  `;
}

function renderRestart() {
  const data = cases.find((item) => item.id === restartCaseId) ?? caseData;
  return `
    <section id="restart-panel" class="restart-panel" aria-labelledby="restart-title">
      <h2 id="restart-title">새 수첩을 펼칠까요?</h2>
      <p>「${escapeHtml(data.title)}」의 조사 기록·힌트·완료 상태만 초기화합니다. 다른 사건의 진행은 유지됩니다.</p>
      <div class="button-row">
        ${actionButton('처음부터 시작하기', 'restart', '', 'button primary')}
        ${actionButton('현재 기록 유지', 'restart-cancel', '', 'button secondary')}
      </div>
    </section>
  `;
}

function renderEnding() {
  const culprit = caseData.suspects.find((person) => person.id === caseData.answer.suspectId);

  return `
    ${pageHeading('CASE CLOSED · 해결된 사건', escapeHtml(caseData.ending.title), escapeHtml(caseData.ending.summary))}
    <section class="ending-conclusion">
      <span class="solved-stamp">해결</span>
      <div>
        <h2>범인, ${escapeHtml(culprit.name)}</h2>
        ${paragraphs(caseData.answer.explanation)}
      </div>
    </section>
    <section class="ending-section">
      <div>${eyebrow('그날 밤의 기록')}<h2>사건을 다시 잇다</h2></div>
      <ol class="timeline">
        ${caseData.ending.timeline.map((item) => `
          <li><time>${escapeHtml(item.time)}</time><p>${escapeHtml(item.event)}</p></li>
        `).join('')}
      </ol>
    </section>
    <section class="ending-section">
      <div>${eyebrow('말하지 못했던 이유')}<h2>인물들이 숨긴 것</h2></div>
      <div class="lies-list">
        ${caseData.ending.lies.map((item) => `
          <article>
            <h3>${escapeHtml(caseData.suspects.find((person) => person.id === item.personId).name)}</h3>
            <p>${escapeHtml(item.reason)}</p>
          </article>
        `).join('')}
      </div>
    </section>
    <div class="ending-bottom">
      <p>이 사건의 수첩을 덮습니다.<br />
        <span>힌트 ${game.hintLevel}단계 확인 · 추리 ${game.attempts}회 제출</span>
      </p>
      ${actionButton('처음부터 다시 플레이', 'restart-prompt', '', 'button primary')}
    </div>
  `;
}

function goToPage(nextPage) {
  if (!navigation.some((item) => item.id === nextPage)) {
    return;
  }

  if (!game.started && nextPage !== 'overview') {
    return;
  }

  page = game.solved && nextPage === 'submit' ? 'ending' : nextPage;
  if (page === 'talk') {
    game = meetSuspect(game, caseData, selectedPerson);
  }
}

app.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) {
    return;
  }

  event.preventDefault();
  const { action, value } = button.dataset;
  let scrollTarget = null;

  switch (action) {
    case 'open-case':
      openCase(value);
      if (game.solved) page = 'ending';
      break;
    case 'library':
      persist();
      library = true;
      showRestart = false;
      saves.setActive(null);
      break;
    case 'new-case': {
      const data = cases.find((item) => item.id === value);
      if (!data) return;
      const saved = saves.load(data);
      if (saved.state.started || ['damaged', 'incompatible'].includes(saved.status)) {
        restartCaseId = value;
        showRestart = true;
        scrollTarget = '#restart-panel';
      } else {
        openCase(value);
        game = startGame(game);
        goToPage('investigate');
      }
      break;
    }
    case 'retry-save':
      if (library) {
        for (const data of cases) {
          const record = saves.load(data);
          if (record.state.started) saves.save(data, record.state, record.view);
        }
      } else persist();
      break;
    case 'start':
      game = startGame(game);
      goToPage('investigate');
      break;
    case 'navigate':
      goToPage(value);
      break;
    case 'location':
      selectedLocation = value;
      selectedClue = null;
      break;
    case 'inspect':
      game = discoverClue(game, caseData, value);
      selectedClue = value;
      break;
    case 'person':
      selectedPerson = value;
      selectedQuestion = null;
      game = meetSuspect(game, caseData, value);
      break;
    case 'initial':
      selectedQuestion = null;
      break;
    case 'question':
      game = askQuestion(game, caseData, value);
      if (game.questionIds.includes(value)) {
        selectedQuestion = value;
      }
      break;
    case 'toggle-hints':
      showHints = !showHints;
      scrollTarget = showHints ? '#hint-panel' : null;
      break;
    case 'hint':
      game = revealHint(game, caseData);
      scrollTarget = '#hint-panel';
      break;
    case 'restart-prompt':
      restartCaseId = caseData.id;
      showRestart = true;
      scrollTarget = '#restart-panel';
      break;
    case 'restart-cancel':
      showRestart = false;
      break;
    case 'restart':
      openCase(restartCaseId ?? caseData.id);
      game = saves.reset(caseData);
      page = 'overview';
      selectedLocation = caseData.locations[0].id;
      selectedClue = null;
      selectedPerson = caseData.suspects[0].id;
      selectedQuestion = null;
      showRestart = false;
      showHints = false;
      feedback = null;
      solution = { suspectId: '', sceneClueId: '', routeClueId: '' };
      break;
  }

  persist();
  render();
  if (scrollTarget) {
    const panel = document.querySelector(scrollTarget);
    panel?.scrollIntoView({ block: 'start' });
    panel?.setAttribute('tabindex', '-1');
    panel?.focus({ preventScroll: true });
  } else if (['start', 'navigate', 'restart', 'open-case', 'library', 'new-case'].includes(action)) {
    window.scrollTo({ top: 0 });
    document.querySelector('#main-content').focus({ preventScroll: true });
  } else {
    const replacement = [...app.querySelectorAll('[data-action]')].find((item) => (
      item.dataset.action === action && item.dataset.value === value && !item.disabled
    ));
    replacement?.focus({ preventScroll: true });
  }
});

app.addEventListener('change', (event) => {
  if (event.target.closest('#solution-form')) {
    solution[event.target.name] = event.target.value;
    persist();
  }
});

app.addEventListener('submit', (event) => {
  if (event.target.id !== 'solution-form') {
    return;
  }

  event.preventDefault();
  const result = submitSolution(game, caseData, solution);
  game = result.state;
  feedback = result;
  if (game.solved) {
    showHints = false;
    page = 'ending';
  }

  persist();
  render();

  if (game.solved) {
    window.scrollTo({ top: 0 });
    document.querySelector('#main-content').focus({ preventScroll: true });
  } else {
    document.querySelector('.submission-feedback').scrollIntoView({ block: 'nearest' });
  }
});

const activeCase = saves.active();
if (cases.some((data) => data.id === activeCase)) openCase(activeCase);
render();
