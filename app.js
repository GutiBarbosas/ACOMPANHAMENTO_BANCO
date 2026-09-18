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
  gerente: '',
  loja: '',
  colaborador: ''
};

/* Mapa entre cada filtro do painel (Supervisor, Gerente, Loja, Colaborador) e a
   coluna correspondente na aba GERAL, usada para calcular as opções de cada
   filtro de forma dependente dos demais (ver mensalMatchExcluding/refreshMensalFilters). */
const MENSAL_FIELD_COLUMN = { supervisor: COL.SUPER, gerente: COL.GERENTE, loja: COL.LOJA, colaborador: COL.NOME };
const MENSAL_FIELD_SELECT = { supervisor: 'mSupervisor', gerente: 'mGerente', loja: 'mLoja', colaborador: 'mColaborador' };

/* ---------------- Novas fontes ----------------
   COMPARATIVO_TRIMESTRE: COLABORADOR, FUNÇÃO, LOJA, Banco Saldo, MÊS, GERENTE, SUPERVISOR
     → usada na seção "Evolução Mensal do Banco de Horas" (ver mais abaixo).
   POSITIVOS_MES:         COLABORADOR, FUNÇÃO, LOJA, DT, DIA, Banco Total, GERENTE, SUPERVISOR
     → usada na seção "Dias com Banco Positivo" (ver mais abaixo). */

const COL_TRIM = { COLABORADOR: 'COLABORADOR', FUNCAO: 'FUNÇÃO', LOJA: 'LOJA', BANCO_SALDO: 'Banco Saldo', MES: 'MÊS', GERENTE: 'GERENTE', SUPER: 'SUPERVISOR' };
const COL_POS = { COLABORADOR: 'COLABORADOR', FUNCAO: 'FUNÇÃO', LOJA: 'LOJA', DT: 'DT', DIA: 'DIA', BANCO_TOTAL: 'Banco Total', GERENTE: 'GERENTE', SUPER: 'SUPERVISOR' };

const stateComparativoTrimestre = { rows: [] };
const statePositivosMes = { rows: [] };

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

/* ---- Painel de resumo visual da loja (exibido apenas quando expandida) ----
   Mostra apenas o saldo total do mês mais recente e a contagem de
   colaboradores da loja — nenhum indicador baseado em média. */

function buildLojaMonthlyTotals(rows) {
  const byMes = new Map();
  rows.forEach(r => {
    const mes = String(r[COL.MES] || '').trim().toUpperCase();
    if (mesOrderIndex(mes) === MES_ORDER.length) return; // mês não reconhecido, ignora
    const val = parseDecimalHours(r[COL.BANCO]);
    if (Number.isNaN(val)) return;
    byMes.set(mes, (byMes.get(mes) || 0) + val);
  });
  return [...byMes.entries()]
    .map(([mes, sum]) => ({ mes, sum }))
    .sort((a, b) => mesOrderIndex(a.mes) - mesOrderIndex(b.mes));
}

function buildLojaSummaryPanel(rows) {
  const totals = buildLojaMonthlyTotals(rows);
  if (!totals.length) {
    return `<div class="mensal-loja-resumo"><p class="loja-resumo-empty">Sem dados de banco de horas para exibir o resumo da loja.</p></div>`;
  }

  const atual = totals[totals.length - 1];
  const saldoCls = atual.sum > 0 ? 'positive' : (atual.sum < 0 ? 'negative' : '');
  const totalColabs = uniqueSorted(rows, COL.NOME).length;

  return `
    <div class="mensal-loja-resumo">
      <div class="loja-resumo-kpis">
        <div class="info-field">
          <span class="info-label">Saldo total · ${atual.mes}</span>
          <span class="info-value banco-value ${saldoCls}">${decimalHoursToHHMM(atual.sum)}</span>
        </div>
        <div class="info-field">
          <span class="info-label">Colaboradores</span>
          <span class="info-value">${totalColabs}</span>
        </div>
      </div>
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

/* Retorna true se a linha `row` (aba GERAL) é compatível com os filtros
   atualmente selecionados em stateM, ignorando o filtro `exclude`. Usada
   para calcular, para cada um dos 4 filtros, apenas as opções compatíveis
   com o que já foi selecionado nos outros 3 (filtros dependentes entre si). */
function mensalMatchExcluding(row, exclude) {
  if (exclude !== 'supervisor' && stateM.supervisor && row[COL.SUPER] !== stateM.supervisor) return false;
  if (exclude !== 'gerente' && stateM.gerente && row[COL.GERENTE] !== stateM.gerente) return false;
  if (exclude !== 'loja' && stateM.loja && row[COL.LOJA] !== stateM.loja) return false;
  if (exclude !== 'colaborador' && stateM.colaborador && row[COL.NOME] !== stateM.colaborador) return false;
  return true;
}

/* Recalcula as opções dos 4 selects (Supervisor, Gerente, Loja, Colaborador)
   com base na combinação atual dos demais filtros e, se a seleção atual de
   algum filtro deixou de ser compatível com os outros, limpa esse filtro.
   `anchor` é o filtro que o usuário acabou de alterar (se houver): seu valor
   é sempre respeitado como está, e são os OUTROS 3 filtros que podem ser
   limpos caso deixem de ser compatíveis com a nova seleção. Sem `anchor`
   (ex.: carregamento inicial dos dados), todos os 4 são validados entre si. */
function refreshMensalFilters(anchor) {
  const fields = ['supervisor', 'gerente', 'loja', 'colaborador'];
  const toValidate = anchor ? fields.filter(f => f !== anchor) : fields;

  // 1) Invalida seleções que deixaram de ser compatíveis com os demais filtros.
  //    Repete em algumas passadas para acomodar efeitos em cadeia (ex.: limpar
  //    a Loja pode, por sua vez, tornar o Colaborador selecionado incompatível).
  for (let pass = 0; pass < fields.length; pass++) {
    let changedInPass = false;
    toValidate.forEach(f => {
      if (!stateM[f]) return;
      const compatibleRows = stateM.rows.filter(r => mensalMatchExcluding(r, f));
      const values = uniqueSorted(compatibleRows, MENSAL_FIELD_COLUMN[f]);
      if (!values.includes(stateM[f])) { stateM[f] = ''; changedInPass = true; }
    });
    if (!changedInPass) break;
  }

  // 2) Repopula cada select com as opções compatíveis com os outros 3 filtros.
  fields.forEach(f => {
    const compatibleRows = stateM.rows.filter(r => mensalMatchExcluding(r, f));
    const values = uniqueSorted(compatibleRows, MENSAL_FIELD_COLUMN[f]);
    const el = document.getElementById(MENSAL_FIELD_SELECT[f]);
    populateSelect(el, values, f === 'loja' ? lojaLabel : undefined);
    el.value = stateM[f];
  });
}

/* Dispara a atualização completa após a mudança de um dos 4 filtros:
   recalcula as opções dependentes (mantendo `field` como âncora) e atualiza
   as três áreas do Acompanhamento Mensal (árvore Loja/Colaborador, Evolução
   Mensal e Dias com Banco Positivo). */
function onMensalFilterChange(field) {
  refreshMensalFilters(field);
  renderMensalTree();
  renderColabHeader();
  renderEvEvolution();
  renderLojaBarChart();
  renderPosDias();
}

function setupMensalFilters() {
  document.getElementById('mSupervisor').addEventListener('change', e => {
    stateM.supervisor = e.target.value;
    onMensalFilterChange('supervisor');
  });
  document.getElementById('mGerente').addEventListener('change', e => {
    stateM.gerente = e.target.value;
    onMensalFilterChange('gerente');
  });
  document.getElementById('mLoja').addEventListener('change', e => {
    stateM.loja = e.target.value;
    onMensalFilterChange('loja');
  });
  document.getElementById('mColaborador').addEventListener('change', e => {
    stateM.colaborador = e.target.value;
    onMensalFilterChange('colaborador');
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

    refreshMensalFilters();
    renderMensalTree();
    renderColabHeader();
    renderEvEvolution();
    renderLojaBarChart();
    renderPosDias();
  } catch (err) {
    console.error(err);
    document.getElementById('mTreePanel').hidden = true;
    document.getElementById('mEmptyState').hidden = false;
    document.getElementById('mEmptyState').querySelector('p').textContent = 'Erro ao carregar dados da planilha GERAL';
  }
}

/* ---------------- Cabeçalho de identificação do colaborador ---------------- */
/* Mostra Colaborador, Função, Loja, Supervisor e Gerente quando um colaborador
   é selecionado nos filtros do Acompanhamento Mensal. Usa apenas dados já
   carregados da aba GERAL (stateM.rows) — nenhuma fonte nova é consultada. */
function renderColabHeader() {
  const panel = document.getElementById('colabInfoPanel');

  if (!stateM.colaborador) {
    panel.hidden = true;
    return;
  }

  const row = stateM.rows.find(r => r[COL.NOME] === stateM.colaborador);
  if (!row) {
    panel.hidden = true;
    return;
  }

  document.getElementById('colabInfoNome').textContent = row[COL.NOME] || '—';
  document.getElementById('colabInfoFuncao').textContent = row[COL.FUNCAO] || '—';
  document.getElementById('colabInfoLoja').textContent = lojaLabel(row[COL.LOJA]);
  document.getElementById('colabInfoSupervisor').textContent = row[COL.SUPER] || '—';
  document.getElementById('colabInfoGerente').textContent = row[COL.GERENTE] || '—';

  panel.hidden = false;
}

/* ---------------- Evolução Mensal do Banco de Horas (fonte COMPARATIVO_TRIMESTRE) ----------------
   Seção independente da árvore Supervisor → Loja → Colaborador: permite
   selecionar um único colaborador e ver, mês a mês, o saldo do banco de
   horas registrado em COMPARATIVO_TRIMESTRE e se ele aumentou, diminuiu
   ou permaneceu igual em relação ao mês anterior. Quando um supervisor
   e/ou gerente já estiver selecionado nos filtros do Acompanhamento
   Mensal (stateM), a lista de colaboradores é restrita a esse recorte. */

/* Linhas de COMPARATIVO_TRIMESTRE respeitando os filtros de Supervisor/Gerente/Loja
   já aplicados na página, quando selecionados. */
function evFilteredRows() {
  return stateComparativoTrimestre.rows.filter(r =>
    (!stateM.supervisor || r[COL_TRIM.SUPER] === stateM.supervisor) &&
    (!stateM.gerente || r[COL_TRIM.GERENTE] === stateM.gerente) &&
    (!stateM.loja || r[COL_TRIM.LOJA] === stateM.loja)
  );
}

/* Gráfico de linha: Eixo X = Mês, Eixo Y = Saldo do banco de horas (mesma
   fonte COMPARATIVO_TRIMESTRE já usada pela tabela abaixo). Retorna '' quando
   não há nenhum valor numérico para plotar. */
function buildEvLineChart(rows) {
  const sorted = [...rows].sort((a, b) => mesOrderIndex(a[COL_TRIM.MES]) - mesOrderIndex(b[COL_TRIM.MES]));

  const points = sorted.map(r => ({
    mes: mesLabel(r[COL_TRIM.MES]),
    val: parseDecimalHours(r[COL_TRIM.BANCO_SALDO])
  }));

  const validVals = points.map(p => p.val).filter(v => !Number.isNaN(v));
  if (!validVals.length) return '';

  const width = 640, height = 200;
  const padLeft = 46, padRight = 14, padTop = 18, padBottom = 28;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  let min = Math.min(...validVals, 0);
  let max = Math.max(...validVals, 0);
  if (min === max) { min -= 1; max += 1; }

  const xStep = points.length > 1 ? plotW / (points.length - 1) : 0;
  const xAt = i => padLeft + (points.length > 1 ? i * xStep : plotW / 2);
  const yAt = v => padTop + plotH - ((v - min) / (max - min)) * plotH;

  const zeroY = (min <= 0 && max >= 0) ? yAt(0) : null;

  const linePoints = points
    .map((p, i) => (Number.isNaN(p.val) ? null : `${xAt(i).toFixed(1)},${yAt(p.val).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');

  const dots = points.map((p, i) => {
    if (Number.isNaN(p.val)) return '';
    const cls = p.val > 0 ? 'positive' : (p.val < 0 ? 'negative' : '');
    return `<circle class="ev-dot ${cls}" cx="${xAt(i).toFixed(1)}" cy="${yAt(p.val).toFixed(1)}" r="3.5"></circle>`;
  }).join('');

  const xLabels = points.map((p, i) =>
    `<text class="ev-axis-label" x="${xAt(i).toFixed(1)}" y="${height - 8}" text-anchor="middle">${p.mes}</text>`
  ).join('');

  const yMaxLabel = `<text class="ev-axis-label" x="${(padLeft - 8).toFixed(1)}" y="${(padTop + 4).toFixed(1)}" text-anchor="end">${decimalHoursToHHMM(max)}</text>`;
  const yMinLabel = `<text class="ev-axis-label" x="${(padLeft - 8).toFixed(1)}" y="${(padTop + plotH).toFixed(1)}" text-anchor="end">${decimalHoursToHHMM(min)}</text>`;
  const zeroLine = zeroY != null
    ? `<line class="ev-zero" x1="${padLeft}" y1="${zeroY.toFixed(1)}" x2="${width - padRight}" y2="${zeroY.toFixed(1)}"></line>
       <text class="ev-axis-label" x="${(padLeft - 8).toFixed(1)}" y="${(zeroY + 3).toFixed(1)}" text-anchor="end">00:00</text>`
    : '';

  return `
    <svg class="ev-chart-svg" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Gráfico de linha do saldo do banco de horas por mês">
      ${zeroLine}
      <polyline class="ev-line" points="${linePoints}" fill="none"></polyline>
      ${dots}
      ${yMaxLabel}
      ${yMinLabel}
      ${xLabels}
    </svg>`;
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
  const chartWrap = document.getElementById('evChartWrap');
  const emptyState = document.getElementById('evEmptyState');
  const summary = document.getElementById('evSummary');

  if (!stateM.colaborador) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    chartWrap.hidden = true;
    chartWrap.innerHTML = '';
    summary.textContent = '';
    emptyState.hidden = false;
    emptyState.querySelector('p').textContent = 'Selecione um colaborador para ver a evolução do banco de horas.';
    return;
  }

  const rows = evFilteredRows().filter(r => r[COL_TRIM.COLABORADOR] === stateM.colaborador);
  if (!rows.length) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    chartWrap.hidden = true;
    chartWrap.innerHTML = '';
    summary.textContent = '';
    emptyState.hidden = false;
    emptyState.querySelector('p').textContent = 'Nenhum dado encontrado para este colaborador em COMPARATIVO_TRIMESTRE.';
    return;
  }

  const first = rows[0];
  const funcao = first[COL_TRIM.FUNCAO] || '—';
  const loja = lojaLabel(first[COL_TRIM.LOJA]);
  summary.textContent = `${funcao} · ${loja} · ${rows.length} mês(es) disponível(eis)`;

  const chartHtml = buildEvLineChart(rows);
  if (chartHtml) {
    chartWrap.innerHTML = chartHtml;
    chartWrap.hidden = false;
  } else {
    chartWrap.innerHTML = '';
    chartWrap.hidden = true;
  }

  wrap.innerHTML = buildEvEvolutionTable(rows);
  wrap.hidden = false;
  emptyState.hidden = true;
}

/* ---------------- Saldo do Banco de Horas por Colaborador (fonte COMPARATIVO_TRIMESTRE) ----------------
   Gráfico de barras da loja selecionada: Eixo X = Colaborador, Eixo Y = saldo
   do banco de horas no mês mais recente disponível de cada colaborador.
   Respeita os filtros de Supervisor, Gerente e Loja (evFilteredRows) e não
   depende do filtro de Colaborador. Nenhum ranking, média ou indicador novo:
   os colaboradores são exibidos em ordem alfabética. */

/* Para cada colaborador do recorte atual, mantém apenas a linha do mês mais
   recente reconhecido em MES_ORDER. */
function lojaBarItems() {
  const byColab = new Map();
  evFilteredRows().forEach(r => {
    const nome = String(r[COL_TRIM.COLABORADOR] || '').trim();
    if (!nome) return;
    const idx = mesOrderIndex(r[COL_TRIM.MES]);
    if (idx === MES_ORDER.length) return; // mês não reconhecido, ignora
    const prev = byColab.get(nome);
    if (!prev || idx >= prev.idx) {
      byColab.set(nome, { nome, idx, mes: r[COL_TRIM.MES], val: parseDecimalHours(r[COL_TRIM.BANCO_SALDO]) });
    }
  });
  return [...byColab.values()]
    .filter(it => !Number.isNaN(it.val))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }));
}

/* Encurta nomes longos apenas no rótulo do eixo X (o nome completo fica no
   <title> de cada barra). */
function shortColabLabel(nome) {
  const parts = String(nome).trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ? parts[0].slice(0, 14) : '—';
  const label = `${parts[0]} ${parts[parts.length - 1]}`;
  return label.length > 16 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : label;
}

function buildLojaBarChart(items) {
  if (!items.length) return '';

  const slot = 72, barW = 40;
  const padLeft = 52, padRight = 16, padTop = 22, padBottom = 74;
  const width = padLeft + padRight + items.length * slot;
  const height = 280;
  const plotH = height - padTop - padBottom;

  const vals = items.map(it => it.val);
  let min = Math.min(...vals, 0);
  let max = Math.max(...vals, 0);
  if (min === max) { min -= 1; max += 1; }

  const yAt = v => padTop + plotH - ((v - min) / (max - min)) * plotH;
  const zeroY = yAt(0);
  const baseY = padTop + plotH;

  const bars = items.map((it, i) => {
    const xCenter = padLeft + i * slot + slot / 2;
    const x = xCenter - barW / 2;
    const yVal = yAt(it.val);
    const y = Math.min(yVal, zeroY);
    const h = Math.max(Math.abs(yVal - zeroY), 1);
    const cls = it.val > 0 ? 'positive' : (it.val < 0 ? 'negative' : '');
    const labelY = it.val >= 0 ? (y - 6) : (y + h + 12);
    return `
      <g>
        <rect class="loja-bar ${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" rx="3">
          <title>${it.nome} · ${mesLabel(it.mes)} · ${decimalHoursToHHMM(it.val)}</title>
        </rect>
        <text class="loja-bar-value ${cls}" x="${xCenter.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle">${decimalHoursToHHMM(it.val)}</text>
        <text class="ev-axis-label" x="${xCenter.toFixed(1)}" y="${(baseY + 16).toFixed(1)}" text-anchor="end" transform="rotate(-35 ${xCenter.toFixed(1)} ${(baseY + 16).toFixed(1)})">${shortColabLabel(it.nome)}</text>
      </g>`;
  }).join('');

  const yMaxLabel = `<text class="ev-axis-label" x="${(padLeft - 8).toFixed(1)}" y="${(padTop + 4).toFixed(1)}" text-anchor="end">${decimalHoursToHHMM(max)}</text>`;
  const yMinLabel = `<text class="ev-axis-label" x="${(padLeft - 8).toFixed(1)}" y="${baseY.toFixed(1)}" text-anchor="end">${decimalHoursToHHMM(min)}</text>`;
  const zeroLine = `
    <line class="ev-zero" x1="${padLeft}" y1="${zeroY.toFixed(1)}" x2="${width - padRight}" y2="${zeroY.toFixed(1)}"></line>
    <text class="ev-axis-label" x="${(padLeft - 8).toFixed(1)}" y="${(zeroY + 3).toFixed(1)}" text-anchor="end">00:00</text>`;

  return `
    <svg class="loja-bar-svg" style="min-width:${width}px" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Gráfico de barras do saldo do banco de horas por colaborador">
      ${zeroLine}
      ${bars}
      ${yMaxLabel}
      ${yMinLabel}
    </svg>`;
}

function renderLojaBarChart() {
  const chartWrap = document.getElementById('lojaBarChartWrap');
  const emptyState = document.getElementById('lojaBarEmptyState');
  const summary = document.getElementById('lojaBarSummary');
  if (!chartWrap || !emptyState || !summary) return;

  const clear = msg => {
    chartWrap.innerHTML = '';
    chartWrap.hidden = true;
    summary.textContent = '';
    emptyState.hidden = false;
    emptyState.querySelector('p').textContent = msg;
  };

  if (!stateM.loja) {
    clear('Selecione uma loja para ver o saldo do banco de horas por colaborador.');
    return;
  }

  const items = lojaBarItems();
  if (!items.length) {
    clear('Nenhum saldo de banco de horas encontrado para esta loja em COMPARATIVO_TRIMESTRE.');
    return;
  }

  const meses = [...new Set(items.map(it => mesLabel(it.mes)))];
  summary.textContent = `${lojaLabel(stateM.loja)} · ${items.length} colaborador(es) · mês mais recente: ${meses.join(', ')}`;
  chartWrap.innerHTML = buildLojaBarChart(items);
  chartWrap.hidden = false;
  emptyState.hidden = true;
}

/* ---------------- Dias com Banco Positivo (fonte POSITIVOS_MÊS) ----------------
   Usa os mesmos 4 filtros do Acompanhamento Mensal (Supervisor, Gerente,
   Loja e Colaborador — stateM). Lista, em ordem cronológica, cada dia em
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

/* Linhas de POSITIVOS_MÊS respeitando os filtros de Supervisor/Gerente/Loja
   já aplicados na página, quando selecionados (mesmo critério de evFilteredRows). */
function posFilteredRows() {
  return statePositivosMes.rows.filter(r =>
    (!stateM.supervisor || r[COL_POS.SUPER] === stateM.supervisor) &&
    (!stateM.gerente || r[COL_POS.GERENTE] === stateM.gerente) &&
    (!stateM.loja || r[COL_POS.LOJA] === stateM.loja)
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

  if (!stateM.colaborador) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    summary.textContent = '';
    emptyState.hidden = false;
    emptyState.querySelector('p').textContent = 'Selecione um colaborador para ver os dias com banco positivo.';
    return;
  }

  const rows = posFilteredRows().filter(r => r[COL_POS.COLABORADOR] === stateM.colaborador);
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
    renderEvEvolution();
    renderLojaBarChart();
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
  initMensal();
  loadComparativoTrimestre();
  loadPositivosMes();
}

document.addEventListener('DOMContentLoaded', init);
