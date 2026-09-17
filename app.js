/* ==========================================================================
   Dashboard de Registro e Venda — leitura direta do Google Sheets publicado
   (CSV). Sem frameworks, sem build tools. Os dados são buscados nas URLs
   abaixo a cada carregamento da página; para atualizar, basta editar a
   planilha de origem — nenhuma alteração de código é necessária.
   Colunas esperadas (aba GERAL/COMPARATIVO): NOME,ADMISSÃO,FUNÇÃO,LOJA,BANCO,MÊS,GERENTE,SUPERVISOR
   ========================================================================== */

const SHEET_URLS = {
  GERAL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSxpLcHLU6BqeDr874WX-uiPBOIVnT6RmIjVr4QrMNXkDYmBjIKpNS2YzKeSaCUffyJV-V9DogWwVQD/pub?gid=0&single=true&output=csv',
  COMPARATIVO_TRIMESTRE: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQVQWz0tZt_BQQ-fHi1F8fGrrLk7emZBDf-mcS8y8tN8orZroYAZFXxgpTmgsXSNBj8ZYv7IXhHJM74/pub?gid=0&single=true&output=csv',
  POSITIVOS_MES: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQVQWz0tZt_BQQ-fHi1F8fGrrLk7emZBDf-mcS8y8tN8orZroYAZFXxgpTmgsXSNBj8ZYv7IXhHJM74/pub?gid=1216823972&single=true&output=csv'
};

/* Adiciona um parâmetro de cache-busting para evitar que o navegador ou o
   Google Sheets sirvam uma versão antiga do CSV publicado. */
function sheetUrl(base) {
  return base + '&t=' + Date.now();
}

/* ---------------- Acompanhamento Mensal (aba GERAL) ---------------- */

const MES_LABELS = {
  '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril',
  '05': 'Maio', '06': 'Junho', '07': 'Julho', '08': 'Agosto',
  '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro'
};

/* Ordem cronológica dos meses (a planilha traz abreviações em português,
   ex: JAN, FEV, MAR... que não podem ser ordenadas alfabeticamente). */
const MES_ORDER = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

function mesOrderIndex(m) {
  const idx = MES_ORDER.indexOf(String(m || '').trim().toUpperCase());
  return idx === -1 ? MES_ORDER.length : idx;
}

const COL = { NOME: 'NOME', ADMISSAO: 'ADMISSÃO', FUNCAO: 'FUNÇÃO', LOJA: 'LOJA', BANCO: 'BANCO', MES: 'MÊS', GERENTE: 'GERENTE', SUPER: 'SUPERVISOR' };

const stateM = {
  rows: [],
  supervisor: '',
  gerente: ''
};

/* ---------------- Novas fontes ----------------
   COMPARATIVO_TRIMESTRE: COLABORADOR, FUNÇÃO, LOJA, Banco Saldo, MÊS, GERENTE, SUPERVISOR
     → usada na seção "Evolução Mensal do Banco de Horas" (ver mais abaixo).
   POSITIVOS_MES:         COLABORADOR, FUNÇÃO, LOJA, DT, DIA, Banco Total, GERENTE, SUPERVISOR
     → usada na seção "Dias com Banco Positivo" (ver mais abaixo). */

const COL_TRIM = { COLABORADOR: 'COLABORADOR', FUNCAO: 'FUNÇÃO', LOJA: 'LOJA', BANCO_SALDO: 'Banco Saldo', MES: 'MÊS', GERENTE: 'GERENTE', SUPER: 'SUPERVISOR' };
const COL_POS = { COLABORADOR: 'COLABORADOR', FUNCAO: 'FUNÇÃO', LOJA: 'LOJA', DT: 'DT', DIA: 'DIA', BANCO_TOTAL: 'Banco Total', GERENTE: 'GERENTE', SUPER: 'SUPERVISOR' };

const stateComparativoTrimestre = { rows: [] };
const statePositivosMes = { rows: [] };

const stateEv = { colaborador: '' };

/* ---------------- CSV parsing (minimal, handles quoted fields) ---------------- */

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length && r.some(v => v !== ''));
}

function csvToObjects(text) {
  const rows = parseCSV(text);
  const headers = rows[0];
  return rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = (r[i] ?? '').trim());
    return obj;
  });
}

/* ---------------- Formatting helpers ---------------- */

function lojaLabel(loja) {
  if (loja === '' || loja == null) return '—';
  const n = String(loja);
  return `Loja ${n.padStart(2, '0')}`;
}

function mesLabel(m) {
  if (!m) return '—';
  const match = String(m).match(/^(\d{4})-(\d{2})$/);
  if (match) return `${MES_LABELS[match[2]] || match[2]}/${match[1]}`;
  return String(m);
}

function parseDecimalHours(raw) {
  if (raw == null || raw === '') return NaN;
  let s = String(raw).trim();
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
  else if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
  return parseFloat(s);
}

function decimalHoursToHHMM(raw) {
  const n = parseDecimalHours(raw);
  if (Number.isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '+';
  const totalMinutes = Math.round(Math.abs(n) * 60);
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${sign}${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/* ---------------- Populate filter dropdowns ---------------- */

function uniqueSorted(rows, key) {
  return [...new Set(rows.map(r => r[key]).filter(v => v !== '' && v != null))]
    .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true }));
}

function populateSelect(el, values, formatter) {
  const current = el.value;
  const placeholder = el.querySelector('option[value=""]');
  el.innerHTML = '';
  if (placeholder) el.appendChild(placeholder);
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = formatter ? formatter(v) : v;
    el.appendChild(opt);
  });
  if ([...el.options].some(o => o.value === current)) el.value = current;
}

/* ---------------- Acompanhamento Mensal: visão hierárquica ---------------- */
/* Supervisor → Lojas (expansível) → Colaboradores (expansível) → Evolução mensal */

function variacao(current, previous) {
  const nCur = parseDecimalHours(current);
  const nPrev = parseDecimalHours(previous);
  if (Number.isNaN(nCur) || Number.isNaN(nPrev)) return { text: '—', cls: '' };
  const diff = nCur - nPrev;
  if (diff === 0) return { text: decimalHoursToHHMM(0), cls: '' };
  return { text: decimalHoursToHHMM(diff), cls: diff > 0 ? 'positive' : 'negative' };
}

function buildColabEvolutionTable(rows) {
  const sorted = [...rows].sort((a, b) => mesOrderIndex(a[COL.MES]) - mesOrderIndex(b[COL.MES]));
  const trs = sorted.map((r, i) => {
    const n = parseDecimalHours(r[COL.BANCO]);
    const bancoCls = Number.isNaN(n) ? '' : (n < 0 ? 'negative' : (n > 0 ? 'positive' : ''));
    const varInfo = i === 0 ? { text: '—', cls: '' } : variacao(r[COL.BANCO], sorted[i - 1][COL.BANCO]);
    return `
      <tr>
        <td>${mesLabel(r[COL.MES])}</td>
        <td class="num"><span class="banco-value ${bancoCls}">${decimalHoursToHHMM(r[COL.BANCO])}</span></td>
        <td class="num"><span class="banco-value ${varInfo.cls}">${varInfo.text}</span></td>
      </tr>`;
  }).join('');

  return `
    <table>
      <thead>
        <tr>
          <th>Mês</th>
          <th class="num">Banco de horas</th>
          <th class="num">Variação</th>
        </tr>
      </thead>
      <tbody>${trs}</tbody>
    </table>`;
}

/* ---- Painel de resumo visual da loja (exibido apenas quando expandida) ---- */

function buildLojaMonthlySeries(rows) {
  const byMes = new Map();
  rows.forEach(r => {
    const mes = String(r[COL.MES] || '').trim().toUpperCase();
    if (mesOrderIndex(mes) === MES_ORDER.length) return; // mês não reconhecido, ignora
    const val = parseDecimalHours(r[COL.BANCO]);
    if (Number.isNaN(val)) return;
    if (!byMes.has(mes)) byMes.set(mes, { sum: 0, count: 0 });
    const acc = byMes.get(mes);
    acc.sum += val; // soma em horas decimais — o carry para HH:MM só acontece na formatação final
    acc.count += 1;
  });
  return [...byMes.entries()]
    .map(([mes, acc]) => ({ mes, avg: acc.sum / acc.count, sum: acc.sum, count: acc.count }))
    .sort((a, b) => mesOrderIndex(a.mes) - mesOrderIndex(b.mes));
}

/* Situação da loja + variação da média, com base na comparação mês atual x mês anterior. */
function buildLojaSituacao(atual, anterior) {
  if (!anterior) {
    return {
      emoji: '🟡', label: 'Estável', cls: 'estavel',
      varText: '—', varCls: ''
    };
  }
  const diff = atual.avg - anterior.avg;
  const diffMin = Math.round(diff * 60);
  const varText = decimalHoursToHHMM(diff);
  const varCls = diffMin > 0 ? 'positive' : (diffMin < 0 ? 'negative' : '');

  if (diffMin > 0) return { emoji: '🟢', label: 'Evolução positiva', cls: 'positiva', varText, varCls };
  if (diffMin < 0) return { emoji: '🔴', label: 'Evolução negativa', cls: 'negativa', varText, varCls };
  return { emoji: '🟡', label: 'Estável', cls: 'estavel', varText, varCls };
}

function buildLojaColabComparison(rows, atualMes, anteriorMes) {
  if (!anteriorMes) return null;
  const nomes = uniqueSorted(rows, COL.NOME);
  let up = 0, down = 0, flat = 0;
  nomes.forEach(nome => {
    const colabRows = rows.filter(r => r[COL.NOME] === nome);
    const rAtual = colabRows.find(r => String(r[COL.MES]).trim().toUpperCase() === atualMes);
    const rAnterior = colabRows.find(r => String(r[COL.MES]).trim().toUpperCase() === anteriorMes);
    if (!rAtual || !rAnterior) return; // sem os dois meses para comparar
    const vAtual = parseDecimalHours(rAtual[COL.BANCO]);
    const vAnterior = parseDecimalHours(rAnterior[COL.BANCO]);
    if (Number.isNaN(vAtual) || Number.isNaN(vAnterior)) return;
    const diffMin = Math.round((vAtual - vAnterior) * 60);
    if (diffMin > 0) up++;
    else if (diffMin < 0) down++;
    else flat++;
  });
  return { up, down, flat };
}

function buildLojaSparkline(series) {
  if (series.length < 2) {
    return `<p class="loja-resumo-chart-empty">Dados insuficientes para exibir a evolução mensal.</p>`;
  }
  const w = 480, h = 108, padX = 24, padY = 18;
  const values = series.map(s => s.avg);
  let min = Math.min(...values, 0);
  let max = Math.max(...values, 0);
  if (min === max) { min -= 1; max += 1; }
  const spanX = w - 2 * padX;
  const spanY = h - 2 * padY;
  const xAt = i => padX + (i / (series.length - 1)) * spanX;
  const yAt = v => padY + spanY - ((v - min) / (max - min)) * spanY;

  const pts = series.map((s, i) => `${xAt(i).toFixed(1)},${yAt(s.avg).toFixed(1)}`).join(' ');

  const zeroLine = (min < 0 && max > 0)
    ? `<line x1="${padX}" y1="${yAt(0).toFixed(1)}" x2="${w - padX}" y2="${yAt(0).toFixed(1)}" class="spark-zero"/>`
    : '';

  const dots = series.map((s, i) => {
    const x = xAt(i), y = yAt(s.avg);
    const cls = s.avg > 0 ? 'positive' : (s.avg < 0 ? 'negative' : '');
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" class="spark-dot ${cls}"><title>${s.mes}: ${decimalHoursToHHMM(s.avg)}</title></circle>`;
  }).join('');

  const labels = series.map((s, i) =>
    `<text x="${xAt(i).toFixed(1)}" y="${h - 4}" class="spark-label" text-anchor="middle">${s.mes}</text>`
  ).join('');

  return `
    <svg viewBox="0 0 ${w} ${h}" class="loja-resumo-svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Evolução mensal do banco de horas da loja">
      ${zeroLine}
      <polyline points="${pts}" class="spark-line" fill="none"/>
      ${dots}
      ${labels}
    </svg>`;
}

function buildLojaSummaryPanel(rows) {
  const series = buildLojaMonthlySeries(rows);
  if (!series.length) {
    return `<div class="mensal-loja-resumo"><p class="loja-resumo-empty">Sem dados de banco de horas para exibir o resumo da loja.</p></div>`;
  }

  const atual = series[series.length - 1];
  const anterior = series.length > 1 ? series[series.length - 2] : null;
  const situacao = buildLojaSituacao(atual, anterior);
  const comparison = buildLojaColabComparison(rows, atual.mes, anterior ? anterior.mes : null);

  const mediaCls = atual.avg > 0 ? 'positive' : (atual.avg < 0 ? 'negative' : '');
  const saldoCls = atual.sum > 0 ? 'positive' : (atual.sum < 0 ? 'negative' : '');
  const totalColabs = uniqueSorted(rows, COL.NOME).length;

  const colabsLine = comparison
    ? `🟢 <span class="colab-count up">${comparison.up}</span> com aumento · 🔴 <span class="colab-count down">${comparison.down}</span> com redução · ⚪ <span class="colab-count flat">${comparison.flat}</span> sem alteração`
    : 'Sem mês anterior para comparar colaboradores.';

  return `
    <div class="mensal-loja-resumo">
      <div class="loja-resumo-chart-wrap">
        <span class="info-label">Evolução mensal · banco de horas</span>
        ${buildLojaSparkline(series)}
      </div>
      <div class="loja-resumo-kpis">
        <div class="info-field">
          <span class="info-label">Situação da loja</span>
          <span class="info-value situacao-value ${situacao.cls}">${situacao.emoji} ${situacao.label}</span>
        </div>
        <div class="info-field">
          <span class="info-label">Média atual · ${atual.mes}</span>
          <span class="info-value banco-value ${mediaCls}">${decimalHoursToHHMM(atual.avg)}</span>
        </div>
        <div class="info-field">
          <span class="info-label">Variação vs. mês anterior</span>
          <span class="info-value banco-value ${situacao.varCls}">${situacao.varText}</span>
        </div>
        <div class="info-field">
          <span class="info-label">Saldo total · ${atual.mes}</span>
          <span class="info-value banco-value ${saldoCls}">${decimalHoursToHHMM(atual.sum)}</span>
        </div>
        <div class="info-field">
          <span class="info-label">Colaboradores</span>
          <span class="info-value">${totalColabs}</span>
        </div>
      </div>
      <div class="loja-resumo-colabs-line">${colabsLine}</div>
    </div>`;
}

function buildColabNode(nome, rows) {
  const first = rows[0];
  const funcao = first[COL.FUNCAO] || '—';
  return `
    <details class="mensal-colab">
      <summary>
        <span class="mensal-colab-name">${nome}</span>
        <span class="mensal-colab-meta">${funcao} · ${rows.length} mês(es) <span class="chevron">▸</span></span>
      </summary>
      <div class="mensal-colab-table-wrap">${buildColabEvolutionTable(rows)}</div>
    </details>`;
}

function buildLojaNode(loja, rows) {
  const colabNames = uniqueSorted(rows, COL.NOME);
  const colabNodes = colabNames.map(nome =>
    buildColabNode(nome, rows.filter(r => r[COL.NOME] === nome))
  ).join('');

  return `
    <details class="mensal-store">
      <summary>
        <span>${lojaLabel(loja)}</span>
        <span class="mensal-store-meta">${colabNames.length} colaborador(es) <span class="chevron">▸</span></span>
      </summary>
      ${buildLojaSummaryPanel(rows)}
      <div class="mensal-colab-list">${colabNodes}</div>
    </details>`;
}

function renderMensalTree() {
  const treePanel = document.getElementById('mTreePanel');
  const tree = document.getElementById('mTree');
  const emptyState = document.getElementById('mEmptyState');

  if (!stateM.supervisor && !stateM.gerente) {
    treePanel.hidden = true;
    emptyState.hidden = false;
    emptyState.querySelector('p').textContent = 'Selecione um supervisor e/ou um gerente para ver as lojas e colaboradores.';
    tree.innerHTML = '';
    return;
  }

  const rows = stateM.rows.filter(r =>
    (!stateM.supervisor || r[COL.SUPER] === stateM.supervisor) &&
    (!stateM.gerente || r[COL.GERENTE] === stateM.gerente)
  );
  if (!rows.length) {
    treePanel.hidden = true;
    emptyState.hidden = false;
    emptyState.querySelector('p').textContent = 'Nenhum dado encontrado para os filtros selecionados.';
    tree.innerHTML = '';
    return;
  }

  const lojas = uniqueSorted(rows, COL.LOJA);
  tree.innerHTML = lojas.map(loja => buildLojaNode(loja, rows.filter(r => r[COL.LOJA] === loja))).join('');

  const totalColab = uniqueSorted(rows, COL.NOME).length;
  document.getElementById('mTreeSummary').textContent =
    `${lojas.length} loja(s) · ${totalColab} colaborador(es)`;

  treePanel.hidden = false;
  emptyState.hidden = true;
}

function setupMensalFilters() {
  document.getElementById('mSupervisor').addEventListener('change', e => {
    stateM.supervisor = e.target.value;
    renderMensalTree();
    refreshEvColaborador();
  });
  document.getElementById('mGerente').addEventListener('change', e => {
    stateM.gerente = e.target.value;
    renderMensalTree();
    refreshEvColaborador();
  });
}

/* ---- Exportar PDF (Acompanhamento Mensal) ----
   Usa a impressão do navegador ("Salvar como PDF"): não exige bibliotecas externas.
   Regra: se nenhuma loja estiver expandida, exporta TODAS as lojas do filtro atual
   (relatório por supervisor/gerente). Se uma ou mais lojas já estiverem expandidas,
   exporta somente essas (relatório por loja). */
function setupMensalExport() {
  document.getElementById('exportMensalPdf').addEventListener('click', exportMensalPDF);
}

function exportMensalPDF() {
  const tree = document.getElementById('mTree');
  const allStores = [...tree.querySelectorAll(':scope > details.mensal-store')];
  if (!allStores.length) return;

  const openStores = allStores.filter(d => d.open);
  const storesToExport = openStores.length ? openStores : allStores;

  // Guarda o estado atual (aberto/fechado) de lojas e colaboradores para restaurar após a impressão
  const snapshot = allStores.map(d => ({
    el: d,
    open: d.open,
    colabs: [...d.querySelectorAll('details.mensal-colab')].map(c => ({ el: c, open: c.open }))
  }));

  // Expande as lojas/colaboradores que entrarão no PDF e esconde as demais
  allStores.forEach(d => {
    const include = storesToExport.includes(d);
    d.classList.toggle('print-hide', !include);
    if (include) {
      d.open = true;
      d.querySelectorAll('details.mensal-colab').forEach(c => { c.open = true; });
    }
  });

  updateMensalPrintHeader(storesToExport.length === allStores.length ? 'supervisor' : 'loja', storesToExport.length);

  const restore = () => {
    snapshot.forEach(({ el, open, colabs }) => {
      el.classList.remove('print-hide');
      el.open = open;
      colabs.forEach(({ el: c, open: co }) => { c.open = co; });
    });
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);

  window.print();
}

function updateMensalPrintHeader(modo, totalLojas) {
  const header = document.getElementById('mPrintHeader');
  const supervisorText = stateM.supervisor || 'Todos';
  const gerenteText = stateM.gerente || 'Todos';
  const agora = new Date();
  const dataStr = agora.toLocaleDateString('pt-BR');
  const horaStr = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const escopo = modo === 'loja'
    ? `${totalLojas} loja(s) selecionada(s)`
    : 'Todas as lojas do filtro';

  header.innerHTML = `
    <h1>Acompanhamento Mensal · Banco de Horas</h1>
    <p><strong>Supervisor:</strong> ${supervisorText} &nbsp;·&nbsp; <strong>Gerente:</strong> ${gerenteText} &nbsp;·&nbsp; ${escopo}</p>
    <p class="print-header-date">Gerado em ${dataStr} às ${horaStr}</p>
  `;
}

async function initMensal() {
  setupMensalFilters();
  setupMensalExport();
  try {
    const res = await fetch(sheetUrl(SHEET_URLS.GERAL), { cache: 'no-store' });
    if (!res.ok) throw new Error('Falha ao carregar planilha GERAL');
    const text = await res.text();
    stateM.rows = csvToObjects(text);

    populateSelect(document.getElementById('mSupervisor'), uniqueSorted(stateM.rows, COL.SUPER));
    populateSelect(document.getElementById('mGerente'), uniqueSorted(stateM.rows, COL.GERENTE));
    renderMensalTree();
  } catch (err) {
    console.error(err);
    document.getElementById('mTreePanel').hidden = true;
    document.getElementById('mEmptyState').hidden = false;
    document.getElementById('mEmptyState').querySelector('p').textContent = 'Erro ao carregar dados da planilha GERAL';
  }
}

/* ---------------- Evolução Mensal do Banco de Horas (fonte COMPARATIVO_TRIMESTRE) ----------------
   Seção independente da árvore Supervisor → Loja → Colaborador: permite
   selecionar um único colaborador e ver, mês a mês, o saldo do banco de
   horas registrado em COMPARATIVO_TRIMESTRE e se ele aumentou, diminuiu
   ou permaneceu igual em relação ao mês anterior. Quando um supervisor
   e/ou gerente já estiver selecionado nos filtros do Acompanhamento
   Mensal (stateM), a lista de colaboradores é restrita a esse recorte. */

/* Linhas de COMPARATIVO_TRIMESTRE respeitando os filtros de Supervisor/Gerente
   já aplicados na página, quando selecionados. */
function evFilteredRows() {
  return stateComparativoTrimestre.rows.filter(r =>
    (!stateM.supervisor || r[COL_TRIM.SUPER] === stateM.supervisor) &&
    (!stateM.gerente || r[COL_TRIM.GERENTE] === stateM.gerente)
  );
}

function buildEvEvolutionTable(rows) {
  const sorted = [...rows].sort((a, b) => mesOrderIndex(a[COL_TRIM.MES]) - mesOrderIndex(b[COL_TRIM.MES]));
  const trs = sorted.map((r, i) => {
    const n = parseDecimalHours(r[COL_TRIM.BANCO_SALDO]);
    const saldoCls = Number.isNaN(n) ? '' : (n < 0 ? 'negative' : (n > 0 ? 'positive' : ''));

    let statusHtml;
    if (i === 0) {
      statusHtml = `<span class="badge badge-neutral">Primeiro mês</span>`;
    } else {
      const nPrev = parseDecimalHours(sorted[i - 1][COL_TRIM.BANCO_SALDO]);
      if (Number.isNaN(n) || Number.isNaN(nPrev)) {
        statusHtml = `<span class="badge badge-neutral">—</span>`;
      } else {
        const diffMin = Math.round((n - nPrev) * 60);
        if (diffMin > 0) statusHtml = `<span class="badge badge-registro">▲ Aumentou</span>`;
        else if (diffMin < 0) statusHtml = `<span class="badge badge-noregistro">▼ Diminuiu</span>`;
        else statusHtml = `<span class="badge badge-neutral">= Igual</span>`;
      }
    }

    return `
      <tr>
        <td>${mesLabel(r[COL_TRIM.MES])}</td>
        <td class="num"><span class="banco-value ${saldoCls}">${decimalHoursToHHMM(r[COL_TRIM.BANCO_SALDO])}</span></td>
        <td>${statusHtml}</td>
      </tr>`;
  }).join('');

  return `
    <table>
      <thead>
        <tr>
          <th>Mês</th>
          <th class="num">Saldo do banco de horas</th>
          <th>Em relação ao mês anterior</th>
        </tr>
      </thead>
      <tbody>${trs}</tbody>
    </table>`;
}

function renderEvEvolution() {
  const wrap = document.getElementById('evTableWrap');
  const emptyState = document.getElementById('evEmptyState');
  const summary = document.getElementById('evSummary');

  if (!stateEv.colaborador) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    summary.textContent = '';
    emptyState.hidden = false;
    emptyState.querySelector('p').textContent = 'Selecione um colaborador para ver a evolução do banco de horas.';
    return;
  }

  const rows = evFilteredRows().filter(r => r[COL_TRIM.COLABORADOR] === stateEv.colaborador);
  if (!rows.length) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    summary.textContent = '';
    emptyState.hidden = false;
    emptyState.querySelector('p').textContent = 'Nenhum dado encontrado para este colaborador em COMPARATIVO_TRIMESTRE.';
    return;
  }

  const first = rows[0];
  const funcao = first[COL_TRIM.FUNCAO] || '—';
  const loja = lojaLabel(first[COL_TRIM.LOJA]);
  summary.textContent = `${funcao} · ${loja} · ${rows.length} mês(es) disponível(eis)`;

  wrap.innerHTML = buildEvEvolutionTable(rows);
  wrap.hidden = false;
  emptyState.hidden = true;
}

/* Repopula o select de colaboradores com base no filtro atual (Supervisor/Gerente)
   e mantém a seleção atual se ela ainda existir na nova lista. */
function refreshEvColaborador() {
  const sel = document.getElementById('evColaborador');
  populateSelect(sel, uniqueSorted(evFilteredRows(), COL_TRIM.COLABORADOR));
  stateEv.colaborador = sel.value;
  renderEvEvolution();
  renderPosDias();
}

function setupEvFilters() {
  document.getElementById('evColaborador').addEventListener('change', e => {
    stateEv.colaborador = e.target.value;
    renderEvEvolution();
    renderPosDias();
  });
}

/* ---------------- Dias com Banco Positivo (fonte POSITIVOS_MÊS) ----------------
   Usa o mesmo colaborador selecionado em "Evolução Mensal do Banco de Horas"
   (stateEv.colaborador) e os mesmos filtros de Supervisor/Gerente do
   Acompanhamento Mensal (stateM). Lista, em ordem cronológica, cada dia em
   que o colaborador teve banco positivo: DATA (DT), DIA e BANCO TOTAL. */

/* Converte o valor de DT (data) vindo do CSV publicado em um objeto Date.
   Assume o formato brasileiro DD/MM/AAAA (mesma convenção de locale usada
   no restante do painel); cai para ISO (AAAA-MM-DD) ou Date.parse como
   alternativas caso o Google Sheets publique em outro formato. */
function parseDT(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();

  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    return isNaN(d.getTime()) ? null : d;
  }

  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function formatDT(raw) {
  const d = parseDT(raw);
  if (!d) return raw ? String(raw) : '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/* Linhas de POSITIVOS_MÊS respeitando os filtros de Supervisor/Gerente
   já aplicados na página, quando selecionados (mesmo critério de evFilteredRows). */
function posFilteredRows() {
  return statePositivosMes.rows.filter(r =>
    (!stateM.supervisor || r[COL_POS.SUPER] === stateM.supervisor) &&
    (!stateM.gerente || r[COL_POS.GERENTE] === stateM.gerente)
  );
}

function buildPosTable(rows) {
  const sorted = [...rows].sort((a, b) => {
    const ta = parseDT(a[COL_POS.DT]);
    const tb = parseDT(b[COL_POS.DT]);
    return (ta ? ta.getTime() : Infinity) - (tb ? tb.getTime() : Infinity);
  });

  const trs = sorted.map(r => {
    const n = parseDecimalHours(r[COL_POS.BANCO_TOTAL]);
    const cls = Number.isNaN(n) ? '' : (n < 0 ? 'negative' : (n > 0 ? 'positive' : ''));
    return `
      <tr>
        <td>${formatDT(r[COL_POS.DT])}</td>
        <td>${r[COL_POS.DIA] || '—'}</td>
        <td class="num"><span class="banco-value ${cls}">${decimalHoursToHHMM(r[COL_POS.BANCO_TOTAL])}</span></td>
      </tr>`;
  }).join('');

  return `
    <table>
      <thead>
        <tr>
          <th>Data</th>
          <th>Dia</th>
          <th class="num">Banco Total</th>
        </tr>
      </thead>
      <tbody>${trs}</tbody>
    </table>`;
}

function renderPosDias() {
  const wrap = document.getElementById('posTableWrap');
  const emptyState = document.getElementById('posEmptyState');
  const summary = document.getElementById('posSummary');

  if (!stateEv.colaborador) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    summary.textContent = '';
    emptyState.hidden = false;
    emptyState.querySelector('p').textContent = 'Selecione um colaborador para ver os dias com banco positivo.';
    return;
  }

  const rows = posFilteredRows().filter(r => r[COL_POS.COLABORADOR] === stateEv.colaborador);
  if (!rows.length) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    summary.textContent = '';
    emptyState.hidden = false;
    emptyState.querySelector('p').textContent = 'Nenhum dia com banco positivo encontrado para este colaborador em POSITIVOS_MÊS.';
    return;
  }

  summary.textContent = `${rows.length} dia(s) com banco positivo`;
  wrap.innerHTML = buildPosTable(rows);
  wrap.hidden = false;
  emptyState.hidden = true;
}

/* ---------------- Novas fontes: carregamento ----------------
   Buscam os CSVs e populam os estados acima. loadComparativoTrimestre
   também atualiza a seção "Evolução Mensal do Banco de Horas" assim que
   os dados chegam. loadPositivosMes atualiza a seção "Dias com Banco
   Positivo" assim que os dados chegam. */

async function loadComparativoTrimestre() {
  try {
    const res = await fetch(sheetUrl(SHEET_URLS.COMPARATIVO_TRIMESTRE), { cache: 'no-store' });
    if (!res.ok) throw new Error('Falha ao carregar planilha COMPARATIVO_TRIMESTRE');
    const text = await res.text();
    stateComparativoTrimestre.rows = csvToObjects(text);
    refreshEvColaborador();
  } catch (err) {
    console.error(err);
    document.getElementById('evTableWrap').hidden = true;
    const emptyState = document.getElementById('evEmptyState');
    emptyState.hidden = false;
    emptyState.querySelector('p').textContent = 'Erro ao carregar dados da planilha COMPARATIVO_TRIMESTRE.';
  }
}

async function loadPositivosMes() {
  try {
    const res = await fetch(sheetUrl(SHEET_URLS.POSITIVOS_MES), { cache: 'no-store' });
    if (!res.ok) throw new Error('Falha ao carregar planilha POSITIVOS_MES');
    const text = await res.text();
    statePositivosMes.rows = csvToObjects(text);
    renderPosDias();
  } catch (err) {
    console.error(err);
    document.getElementById('posTableWrap').hidden = true;
    const emptyState = document.getElementById('posEmptyState');
    emptyState.hidden = false;
    emptyState.querySelector('p').textContent = 'Erro ao carregar dados da planilha POSITIVOS_MÊS.';
  }
}

/* ---------------- Mobile sidebar ---------------- */

function setupSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const open = () => { sidebar.classList.add('open'); overlay.classList.add('show'); };
  const close = () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); };
  document.getElementById('menuToggle').addEventListener('click', open);
  overlay.addEventListener('click', close);
}

/* ---------------- Init ---------------- */

async function init() {
  setupSidebarToggle();
  setupEvFilters();
  initMensal();
  loadComparativoTrimestre();
  loadPositivosMes();
}

document.addEventListener('DOMContentLoaded', init);
