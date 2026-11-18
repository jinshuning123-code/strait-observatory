/* 只读展示副本使用的浏览器数据适配，支持文件打开与子目录部署。 */
(() => {
  'use strict';
  const base = new URL('.', document.currentScript.src);
  const files = window.PUBLIC_CATALOG || {};
  const manifest = files['public-data/manifest.json'];
  const nativeFetch = window.fetch.bind(window);
  const reply = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json;charset=utf-8'}});
  const apiName = url => {
    const index = url.pathname.indexOf('/api/');
    return index < 0 ? null : url.pathname.slice(index + 5);
  };

  function route(url) {
    const name = apiName(url), query = url.searchParams;
    if (!manifest) return null;
    if (name === 'material-file') return manifest.materials[query.get('id')];
    if (name === 'ai/run') return manifest.runs[query.get('id')];
    if (name === 'brief') return manifest.briefs[query.get('id')];
    const event = manifest.events[query.get('event_id') || 'EVT252'];
    const candidate = manifest.candidates[query.get('id')];
    if (name === 'ai/event' || name === 'reconstruction-package') return event?.package;
    if (name === 'reconstruction-history') return event?.reconstruction;
    if (name === 'ai/history') return event?.history || manifest.candidates[query.get('event_id')]?.history;
    if (name === 'candidate-detail') return candidate?.detail;
    if (name === 'candidate-package') return candidate?.package;
    return manifest.routes[name];
  }

  function link(raw) {
    if (!raw) return raw;
    const url = new URL(raw, base);
    if (url.origin === base.origin && apiName(url)) {
      const path = route(url);
      if (path) return new URL(path + url.hash, base).href;
    }
    return raw;
  }
  window.PUBLIC_SITE = {link, capturedAt: manifest?.capturedAt};

  const day = value => new Date(value + 'T00:00:00Z');
  const dateText = value => value.toISOString().slice(0, 10);
  function months(start, end) {
    const result = [], cursor = day(start.slice(0, 7) + '-01');
    while (dateText(cursor).slice(0, 7) <= end.slice(0, 7)) {
      result.push(dateText(cursor).slice(0, 7)); cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return result;
  }
  const region = event => typeof event.latitude !== 'number' || typeof event.longitude !== 'number' ? 'unknown' : event.longitude < 103 ? 'west' : event.longitude < 104 ? 'central' : 'east';
  const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');

  async function preview(query) {
    const filters = {start: query.get('start') || '2026-10-01', end: query.get('end') || '2026-10-31', region: query.get('region') || 'all', include_auto: query.get('include_auto') === '1'};
    const start = day(filters.start), end = day(filters.end), days = (end - start) / 86400000 + 1;
    if (!Number.isFinite(days) || days < 1 || days > 366 || !['all','west','central','east','unknown'].includes(filters.region)) throw new Error('请选择有效区域和不超过366天的时间范围');
    const snapshot = files[manifest.snapshot], data = snapshot.data;
    const all = data.events.filter(event => event.in_scope === '是' && (filters.include_auto || event.ingestion_status !== '自动入库待复核') && (filters.region === 'all' || region(event) === filters.region));
    const chosen = all.filter(event => filters.start <= event.date && event.date <= filters.end).sort((a,b) => b.date.localeCompare(a.date));
    const previousEnd = new Date(start - 86400000), previousStart = new Date(start - days * 86400000);
    const previous = all.filter(event => dateText(previousStart) <= event.date && event.date <= dateText(previousEnd));
    const registered = new Set(snapshot.analysis.series.filter(item => item.count !== null).map(item => item.month));
    const missing = months(filters.start, filters.end).filter(month => !registered.has(month));
    const previousMissing = months(dateText(previousStart), dateText(previousEnd)).filter(month => !registered.has(month));
    const original = new Set(snapshot.originalIds), injuries = new Set(snapshot.analysis.injuryConflicts);
    const records = event => {
      const ids = new Set(String(event.record_ids || '').split(/[;；,，\s]+/));
      return data.records.filter(record => record.event_id === event.event_id || ids.has(record.record_id));
    };
    const sourceIds = new Set(chosen.flatMap(event => records(event).map(record => record.source_id)));
    const sourcesById = new Map(data.sources.map(source => [source.source_id, source]));
    const sourceDocuments = new Set([...sourceIds].map(id => sourcesById.get(id)?.URL || id));
    const provisional = chosen.filter(event => event.ingestion_status === '自动入库待复核').length;
    const canCompare = !missing.length && !previousMissing.length && !provisional && !previous.some(event => event.ingestion_status === '自动入库待复核');
    const metrics = {count: chosen.length, originalSnapshot: chosen.filter(event => original.has(event.event_id)).length, databaseAdded: chosen.filter(event => !original.has(event.event_id)).length,
      provisional, located: chosen.filter(event => region(event) !== 'unknown').length, missingCoordinates: chosen.filter(event => region(event) === 'unknown').length,
      sourceConflict: chosen.filter(event => event.verification_status === '存在未解决冲突').length, injuryFlags: chosen.filter(event => injuries.has(event.event_id)).length,
      sourceDocuments: sourceDocuments.size, sourceIds: sourceIds.size, regions: {}, verification: {}, monthly: months(filters.start, filters.end).map(month => {
        const count = chosen.filter(event => event.date.startsWith(month)).length;
        return {month, count: registered.has(month) || count ? count : null, coverage: registered.has(month) ? '原始快照已登记月份，完整性仍待核验' : count ? '补充记录，非完整月份覆盖' : '无完整覆盖，不能当作零事件'};
      })};
    for (const event of chosen) {
      metrics.regions[region(event)] = (metrics.regions[region(event)] || 0) + 1;
      metrics.verification[event.verification_status] = (metrics.verification[event.verification_status] || 0) + 1;
    }
    const evidence = [], seen = new Set();
    for (const event of chosen) {
      for (const record of records(event)) {
        const source = sourcesById.get(record.source_id) || {}, text = record['原文'] || '', key = JSON.stringify([source.URL, record['PDF页'], text]);
        if (!text || seen.has(key)) continue;
        seen.add(key);
        const raw = text.slice(0, 5000), page = record['PDF页'];
        let url = source.local_material_id ? manifest.materials[source.local_material_id] : source.URL || '';
        if (source.local_material_id && page) url += '#page=' + page;
        if (['SRC037','SRC042'].includes(record.source_id) && page) url = 'evidence.html?source=' + record.source_id + '&page=' + page;
        evidence.push({id: 'E' + String(evidence.length + 1).padStart(2, '0'), event_id: event.event_id, record_id: record.record_id, source_id: record.source_id,
          title: source['标题'] || '未登记', pdf_page: page, url, text: raw, truncated: text.length > 5000, textHash: await hash(raw), upstream: source['上游来源'] || '待核实', kind: '发布快照中的来源摘录'});
        if (evidence.length === 6) break;
      }
      if (evidence.length === 6) break;
    }
    const caseReviews = chosen.flatMap(event => {
      const review = snapshot.audit.cases.find(item => item.event_id === event.event_id);
      return review ? [{review, note: '辅助核读意见，待小组复审'}] : [];
    });
    metrics.auxiliaryConflictFlags = caseReviews.filter(item => item.review.hasConflict).length;
    const limitations = ['统计只包含发布时保存的范围内记录。', '资料覆盖与入库延迟不一致，文件份数不能直接作为独立信源数。', '缺少航次分母，不能据此计算单船遇袭概率。'];
    if (missing.length) limitations.unshift('当前资料覆盖不完整的月份：' + missing.join('、') + '。');
    if (!canCompare) limitations.unshift('两个窗口资料覆盖不可比，表中未收录不等于没有发生事件。');
    if (provisional) limitations.push('包含待复核记录 ' + provisional + ' 条。');
    return {filters, capturedAt: manifest.capturedAt, metrics, comparison: {start: dateText(previousStart), end: dateText(previousEnd), tableCount: previous.length,
      notRegisteredMonths: previousMissing, tableDifference: canCompare ? chosen.length - previous.length : null, canCompareTableCounts: canCompare, riskProbability: null},
      coverage: {notRegisteredMonths: missing, registeredMonthsMeaning: '已登记月份不等于资料完整', originalDataHash: snapshot.analysis.dataHash}, limitations,
      events: chosen.map(event => ({...event, status: event.verification_status, region: region(event), mapUrl: 'index.html?event_id=' + event.event_id + '&include_auto=' + (filters.include_auto ? '1' : '0')})),
      sources: evidence, evidenceSelection: '按日期倒序选取，最多6段，各最多5000字；用于回查当前展示资料。', evidenceEventCount: new Set(evidence.map(item => item.event_id)).size,
      caseReviews, snapshotHash: await hash(JSON.stringify({filters, capturedAt: manifest.capturedAt, metrics, evidence}))};
  }

  window.fetch = async (input, options = {}) => {
    const raw = input instanceof Request ? input.url : input;
    const url = new URL(raw, location.href), name = apiName(url);
    if (url.origin !== base.origin) return nativeFetch(input, options);
    if (!name) {
      const relative = decodeURIComponent(url.pathname).slice(decodeURIComponent(base.pathname).length);
      return Object.hasOwn(files, relative) ? reply(files[relative]) : nativeFetch(input, options);
    }
    const method = (options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return reply({error: '在线展示提供已保存成果。生成、采集和修改请在本机研究版进行。'}, 403);
    if (!manifest) return reply({error: '展示资料目录未读到，请完整解压后打开首页。'}, 503);
    if (name === 'brief-preview') {
      try { return reply(await preview(url.searchParams)); } catch (error) { return reply({error: error.message}, 400); }
    }
    const path = route(url), data = files[path];
    if (!data) return reply({error: '这份资料未包含在当前发布快照中。'}, 404);
    return reply(data, data.error ? 400 : 200);
  };

  function updateLinks() {
    for (const anchor of document.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href'), target = link(href);
      if (target !== href) anchor.setAttribute('href', target);
    }
    for (const button of document.querySelectorAll('#generate-event,#generate-ai,#generate-rules,#collect-now,#extract-now,#recheck-candidate,#candidate-ai-generate,#save-review')) button.disabled = true;
    for (const button of document.querySelectorAll('#material-list button')) button.hidden = true;
  }
  document.addEventListener('DOMContentLoaded', () => {
    const header = document.querySelector('header');
    if (header) {
      const badge = document.createElement('span'); badge.className = 'public-mode-label';
      badge.textContent = '在线展示 · 发布快照 ' + new Date(manifest?.capturedAt).toLocaleDateString('zh-CN', {timeZone: 'Asia/Shanghai'});
      badge.title = '可阅读、筛选和下载已保存成果，生成和修改在本机研究版进行。'; header.append(badge);
    }
    if (document.getElementById('focus')) document.getElementById('focus').closest('label').hidden = true;
    updateLinks();
    let pending = false;
    new MutationObserver(() => {
      if (pending) return; pending = true;
      requestAnimationFrame(() => { pending = false; updateLinks(); });
    }).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['href']});
  });
})();
