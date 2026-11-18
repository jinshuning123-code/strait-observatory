'use strict';
const byId = id => document.getElementById(id);
const state = { eventID: '', packet: null, run: null, connection: {}, busy: false, load: 0, attempt: null };

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function request(url, body) {
  const response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '读取失败，请重试');
  return data;
}

function dateLabel(at) {
  return new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function sourceDetails(source, prefix) {
  const box = element('details', undefined, 'source-item');
  box.id = prefix + source.id;
  box.append(element('summary', source.id + ' · ' + source.title + (source.pdf_page ? ' · PDF第' + source.pdf_page + '页' : '')));
  box.append(element('p', source.id.startsWith('N') ? '辅助核读意见，待小组复审。' : (source.kind || '已归档报告页提取文字，需对照原页。'), 'muted'));
  if (source.url) {
    const url = new URL(PUBLIC_SITE.link(source.url), location.href);
    if (['http:', 'https:'].includes(url.protocol)) {
      const link = element('a', source.id.startsWith('N') ? '打开已有核读意见 ↗' : '打开对应报告页 ↗');
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener';
      box.append(link);
    }
  }
  box.append(element('pre', source.text || '这条历史记录未保存材料全文，请查看导出的原始记录。'));
  return box;
}

function citation(id) {
  const button = element('button', id, 'citation');
  button.type = 'button';
  button.addEventListener('click', () => {
    const source = byId('saved-' + id);
    if (!source) return;
    source.open = true;
    source.scrollIntoView({ behavior: 'smooth', block: 'center' });
    source.querySelector('summary').focus();
  });
  return button;
}

function statement(item) {
  const box = element('div', undefined, 'statement');
  const meta = element('div', undefined, 'statement-meta');
  const typeClass = item.type === '报告记载' ? '' : item.type === '分析推断' ? ' inference' : ' unknown';
  meta.append(element('span', item.type, 'type-label' + typeClass), element('span', '支持程度 ' + item.confidence));
  for (const ref of item.evidence) meta.append(citation(ref));
  box.append(meta, element('p', item.text));
  if (item.caveat) box.append(element('p', '前提与局限　' + item.caveat, 'caveat'));
  if (item.citationIssues.length) box.append(element('p', item.citationIssues.join('；'), 'warning'));
  const quotes = element('details', undefined, 'quote-details');
  quotes.append(element('summary', item.citationChecked ? '查看匹配到的引句，内容仍需核对' : '查看模型给出的引句'));
  for (const quote of item.quotes) {
    if (!quote || typeof quote.quote !== 'string') continue;
    quotes.append(element('blockquote', quote.evidence + '　' + quote.quote));
  }
  box.append(quotes);
  return box;
}

function section(title) {
  const node = element('section', undefined, 'report-section');
  node.append(element('h2', title));
  byId('report-area').append(node);
  return node;
}

function showReviews(run) {
  byId('reviews').replaceChildren();
  for (const review of run.reviews || []) {
    const box = element('div', undefined, 'review-note');
    box.append(element('h3', review.status + ' · ' + review.reviewer));
    box.append(element('p', review.note));
    if (review.correction) box.append(element('p', review.correction));
    byId('reviews').append(box);
  }
  if (!run.reviews?.length) byId('reviews').append(element('p', '这份报告尚未保存人工核对意见。', 'muted'));
  byId('review-area').hidden = false;
  byId('review-form').hidden = Boolean(state.connection.readOnly);
}

function reportText(run) {
  const lines = [run.report?.title || '事件重建报告原答', '状态　AI重建草稿，待人工复核', '事件　' + run.event_id,
    '生成时间　' + run.at, '模型　' + run.model, '这次关注点　' + run.question, ''];
  const add = item => {
    lines.push('[' + item.type + ' / 支持程度' + item.confidence + '] ' + item.text + ' ' + item.evidence.map(id => '[' + id + ']').join(''));
    if (item.caveat) lines.push('前提与局限　' + item.caveat);
    for (const quote of item.quotes) if (quote?.quote) lines.push('引句 [' + quote.evidence + '] ' + quote.quote);
    if (item.citationIssues.length) lines.push('引用检查提醒　' + item.citationIssues.join('；'));
    if (item.nextStep) lines.push('如何查证　' + item.nextStep);
    if (item.against) lines.push('反向证据或限制　' + item.against);
    lines.push('');
  };
  if (run.report) {
    lines.push('一、是否涉及同一次事件'); add(run.report.identity);
    for (const [title, key] of [['二、综合经过', 'narrative'], ['三、按报告叙述整理', 'sequence'], ['四、材料之间的关系', 'sourceRelations'], ['五、不同说法与解释', 'conflicts'], ['六、替代解释与检验', 'hypotheses']]) {
      lines.push(title);
      for (const item of run.report[key]) { if (item.stage) lines.push(item.stage + ' / ' + item.time); if (item.field) lines.push(item.field); add(item); }
    }
    lines.push('七、下一步补证');
    for (const gap of run.report.gaps) lines.push(gap.question, gap.nextStep, '');
  } else lines.push(run.answer);
  lines.push('材料出处');
  for (const source of run.sources) lines.push('[' + source.id + '] ' + source.title + (source.pdf_page ? ' / PDF第' + source.pdf_page + '页' : ''), source.url ? new URL(PUBLIC_SITE.link(source.url), location.href).href : '');
  lines.push('', run.checks.meaning, ...run.warnings, '', '人工核对意见');
  for (const review of run.reviews || []) lines.push(review.reviewer + ' / ' + review.status, review.note, review.correction || '', '');
  return lines.join('\r\n');
}

function show(run) {
  state.run = run;
  const area = byId('report-area');
  const reviewState = run.reviews?.at(-1)?.status;
  area.replaceChildren(element('p', 'AI重建草稿 · ' + (reviewState ? '最近核对意见为' + reviewState : '待人工复核'), 'eyebrow'), element('h2', run.report?.title || '返回内容需要检查', 'report-title'));
  area.append(element('p', run.model + ' · ' + dateLabel(run.at) + ' · 记录 ' + run.id, 'report-meta'), element('p', run.question, 'report-meta'));
  const actions = element('div', undefined, 'report-actions');
  const download = element('button', '下载报告文字');
  download.type = 'button';
  download.onclick = () => {
    const url = URL.createObjectURL(new Blob(['\ufeff' + reportText(run)], { type: 'text/plain;charset=utf-8' }));
    const anchor = element('a'); anchor.href = url; anchor.download = run.event_id + '-事件重建-' + run.id + '.txt'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const json = element('a', '下载报告、原始输入和核对记录'); json.href = '/api/ai/run?id=' + run.id; json.download = run.event_id + '-重建证据包-' + run.id + '.json';
  actions.append(download, json); area.append(actions);
  area.append(element('p', run.checks.passed ? '已匹配证据编号和引句，解释与取舍仍需人工核对。' : '本次有内容需要核对，请查看各项提醒及原回答。', run.checks.passed ? 'quote-check' : 'warning'));
  if (run.warnings.length) {
    const notices = element('details', undefined, 'warning'); notices.append(element('summary', '查看本次引用检查提醒（' + run.warnings.length + '项）'));
    const list = element('ul'); for (const warning of run.warnings) list.append(element('li', warning)); notices.append(list); area.append(notices);
  }
  if (run.report) {
    section('是否涉及同一次事件').append(statement(run.report.identity));
    const levels = { '较高': 3, '中等': 2, '较低': 1 };
    const highest = Math.max(...run.report.hypotheses.map(item => levels[item.confidence]));
    const preferred = section('当前优先核查的解释');
    preferred.append(element('p', '以下按AI标注的支持程度选出，仍属于需要检验的推断。', 'muted'));
    for (const item of run.report.hypotheses.filter(item => levels[item.confidence] === highest)) preferred.append(statement(item));
    const narrative = section('目前最有依据的事件经过'); for (const item of run.report.narrative) narrative.append(statement(item));
    const sequence = section('按报告叙述整理经过'); sequence.append(element('p', '未明示时刻的内容按叙述顺序排列。', 'muted'));
    for (const item of run.report.sequence) { const step = element('div', undefined, 'timeline-item'); step.append(element('h3', item.stage + ' · ' + item.time), statement(item)); sequence.append(step); }
    const relations = section('这些材料是不是同一条消息？'); for (const item of run.report.sourceRelations) relations.append(statement(item));
    const conflicts = section('不同说法如何解释？'); for (const item of run.report.conflicts) conflicts.append(element('h3', item.field), statement(item), element('p', '下一步查证　' + item.nextStep, 'caveat'));
    const hypotheses = section('还有哪些可能的解释？'); for (const item of run.report.hypotheses) hypotheses.append(statement(item), element('p', '反向证据或限制　' + item.against, 'caveat'), element('p', '怎样检验　' + item.nextStep, 'caveat'));
    const gaps = section('下一步需要补什么证据？'); const list = element('ol', undefined, 'gaps');
    for (const item of run.report.gaps) { const row = element('li'); row.append(element('strong', item.question), element('p', item.nextStep)); list.append(row); } gaps.append(list);
  }
  const raw = element('details', undefined, 'report-section'); raw.append(element('summary', '查看AI原始回答'), element('pre', run.answer, 'raw-answer')); area.append(raw);
  const snapshot = run.evidenceSnapshot || {};
  byId('run-sources').replaceChildren();
  for (const source of [...(snapshot.sources || run.sources), ...(snapshot.notes || [])]) byId('run-sources').append(sourceDetails(source, 'saved-'));
  byId('used-materials').hidden = false;
  for (const button of byId('history').querySelectorAll('button')) button.classList.toggle('active', Number(button.dataset.id) === run.id);
  showReviews(run);
}

async function loadRun(id) {
  const token = state.load;
  const run = await request('/api/ai/run?id=' + id);
  if (token === state.load) show(run);
}

async function loadHistory(preferredID) {
  const token = state.load;
  const data = await request('/api/reconstruction-history?event_id=' + encodeURIComponent(state.eventID));
  if (token !== state.load) return;
  byId('history').replaceChildren();
  for (const run of data.items) {
    const button = element('button', dateLabel(run.at) + ' · ' + run.model + (run.reviews?.length ? ' · 有人工意见' : ' · 待复核'), 'history-item');
    button.type = 'button'; button.dataset.id = run.id;
    button.onclick = () => loadRun(run.id).catch(error => { byId('generation-status').textContent = error.message; });
    byId('history').append(button);
  }
  if (!data.items.length) byId('history').append(element('p', '这条事件尚未生成重建报告。', 'muted'));
  const chosen = data.items.find(run => run.id === preferredID) || data.items[0];
  if (chosen) await loadRun(chosen.id);
}

function updateGenerate() {
  byId('generate').disabled = state.busy || !state.packet || !state.connection.configured || state.connection.readOnly;
}

async function chooseEvent() {
  state.eventID = byId('event-choice').value;
  state.load += 1; const token = state.load;
  state.packet = null; state.run = null; state.attempt = null;
  byId('report-area').replaceChildren(element('h2', '先查看材料，或打开已有报告'), element('p', '生成后会保存原始输入与引用，方便继续核对。', 'muted'));
  byId('review-area').hidden = true; byId('used-materials').hidden = true;
  byId('generation-status').textContent = ''; byId('package-sources').replaceChildren(); byId('history').textContent = '正在读取已有报告…';
  byId('package-summary').textContent = '正在读取这条事件的材料…';
  byId('compare-link').hidden = true;
  byId('compare-link').href = 'research.html?audit=' + encodeURIComponent(state.eventID) + '#audit-panel';
  byId('ai-link').href = 'event-ai.html?event_id=' + encodeURIComponent(state.eventID);
  const url = new URL(location.href); url.searchParams.set('event_id', state.eventID); history.replaceState(null, '', url);
  updateGenerate();
  const historyTask = loadHistory().catch(error => { if (token === state.load) byId('history').textContent = error.message; });
  try {
    const packet = await request('/api/reconstruction-package?event_id=' + encodeURIComponent(state.eventID));
    if (token !== state.load) return;
    state.packet = packet;
    byId('compare-link').hidden = !packet.sourceAudit;
    byId('package-summary').textContent = '查看将提供给AI的材料（' + packet.sources.length + '段报告文字' + (packet.notes.length ? '、附辅助核读意见' : '') + '）';
    for (const source of [...packet.sources, ...packet.notes]) byId('package-sources').append(sourceDetails(source, 'current-'));
  } catch (error) {
    if (token === state.load) { byId('package-summary').textContent = '当前材料需要补充'; byId('package-sources').append(element('p', error.message)); }
  } finally { if (token === state.load) updateGenerate(); }
  await historyTask;
}

byId('event-choice').onchange = chooseEvent;
byId('refresh-history').onclick = () => loadHistory(state.run?.id).catch(error => { byId('history').textContent = error.message; });
byId('generate-form').onsubmit = async event => {
  event.preventDefault();
  if (state.busy || !state.packet) return;
  const focus = byId('focus').value.trim();
  if (!state.attempt || state.attempt.focus !== focus) state.attempt = { request_id: crypto.randomUUID(), event_id: state.eventID, focus };
  state.busy = true; byId('event-choice').disabled = true; byId('focus').disabled = true; updateGenerate();
  byId('generation-status').textContent = '正在比较报告并重建经过，通常需要几十秒。完成后会自动保存。';
  try {
    const run = await request('/api/ai/reconstruct', state.attempt);
    await loadHistory(run.id);
    state.attempt = null;
    byId('generation-status').textContent = run.report ? '重建草稿已保存，可以逐项查看依据并填写核对意见。' : '原回答已保存，内容未形成完整报告，请查看原答和检查提醒。';
    byId('report-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { byId('generation-status').textContent = error.message + '。可先刷新历史列表，检查是否已经保存。'; }
  finally { state.busy = false; byId('event-choice').disabled = false; byId('focus').disabled = false; updateGenerate(); }
};

byId('review-form').onsubmit = async event => {
  event.preventDefault(); if (!state.run) return;
  const runID = state.run.id;
  byId('save-review').disabled = true;
  try {
    await request('/api/ai/review', { ...Object.fromEntries(new FormData(event.target)), run_id: runID });
    await loadHistory(runID); event.target.reset(); byId('review-status').textContent = '核对意见已保存，原始报告和之前的意见仍可查看。';
  } catch (error) { byId('review-status').textContent = error.message; }
  finally { byId('save-review').disabled = false; }
};

async function init() {
  try {
    const [options, connection] = await Promise.all([request('/api/event-options'), request('/api/ai/status')]);
    state.connection = connection;
    const wanted = new URLSearchParams(location.search).get('event_id') || 'EVT252';
    for (const event of options.items) { const option = element('option', event.ship_name + ' · ' + event.date); option.value = event.event_id; byId('event-choice').append(option); }
    if (options.items.some(event => event.event_id === wanted)) byId('event-choice').value = wanted;
    byId('connection').textContent = connection.readOnly ? '当前为只读演示，可打开和下载已有报告。' : connection.configured ? '已连接 ' + connection.provider + ' · ' + connection.model + '。打开已有报告不调用模型。' : '请先在AI连接设置中配置密钥。';
    await chooseEvent();
  } catch (error) { byId('connection').textContent = error.message + '。请确认本机工作台服务已启动。'; }
}
init();
