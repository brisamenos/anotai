// RELATÓRIOS
// ─────────────────────────────────────────
let _relPeriodo = 'mensal';

function setRelPeriodo(p) {
  _relPeriodo = p;
  ['diario','semanal','mensal','anual'].forEach(id => {
    const btn = document.getElementById('rpb-' + id);
    if (!btn) return;
    const active = id === p;
    btn.style.background  = active ? 'var(--accent)' : '';
    btn.style.color       = active ? '#fff' : '';
    btn.style.borderColor = active ? 'var(--accent)' : '';
  });
  renderRelatorios();
}

function _relGetRange() {
  const now = new Date();
  let inicio, fim, label;
  if (_relPeriodo === 'diario') {
    inicio = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    fim    = new Date(inicio.getTime() + 86400000);
    label  = 'Hoje, ' + inicio.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });
  } else if (_relPeriodo === 'semanal') {
    const day = now.getDay();
    inicio = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
    fim    = new Date(inicio.getTime() + 7 * 86400000);
    label  = inicio.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' })
             + ' – ' + new Date(fim - 1).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });
  } else if (_relPeriodo === 'mensal') {
    inicio = new Date(now.getFullYear(), now.getMonth(), 1);
    fim    = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    label  = inicio.toLocaleDateString('pt-BR', { month:'long', year:'numeric' });
  } else {
    inicio = new Date(now.getFullYear(), 0, 1);
    fim    = new Date(now.getFullYear() + 1, 0, 1);
    label  = String(now.getFullYear());
  }
  return { inicio, fim, label };
}

async function renderRelatorios() {
  const money  = v => 'R$\u00a0' + parseFloat(v||0).toFixed(2).replace('.', ',');
  const moneyK = v => { const n=parseFloat(v||0); return n>=1000 ? 'R$\u00a0'+Math.round(n/1000)+'k' : money(n); };
  const pct    = (a,b) => b>0 ? Math.round(a/b*100)+'%' : '0%';
  const elv    = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  const loading = id  => { const e=document.getElementById(id); if(e) e.innerHTML='<div style="color:var(--muted);font-size:12px;padding:16px;text-align:center">Carregando...</div>'; };

  ['rel-line-chart','rel-hour-bar','rel-day-bar','rel-gauges','rel-platforms',
   'rel-areas','rel-heatmap','rel-month-bar','rel-produtos-list','rel-produtos-fat',
   'rel-cats-bar','rel-top-clients','rel-top-gastos','rel-novos-clientes',
   'rel-entradas-list','rel-fat-pag','rel-sat-list','rel-sat-resumo'].forEach(loading);

  const now      = new Date();
  const range    = _relGetRange();
  const iniISO   = range.inicio.toISOString();
  const fimISO   = range.fim.toISOString();
  const anoIn    = new Date(now.getFullYear(), 0, 1).toISOString();
  const lbl30ago = new Date(now - 30*86400000).toISOString();

  const periLabel = { diario:'hoje', semanal:'na semana', mensal:'no mês', anual:'no ano' }[_relPeriodo] || 'no período';
  const lblEl = document.getElementById('rel-periodo-label');
  if (lblEl) lblEl.textContent = range.label;

  // Atualiza botões de período
  ['diario','semanal','mensal','anual'].forEach(id => {
    const btn = document.getElementById('rpb-'+id);
    if (!btn) return;
    const on = id === _relPeriodo;
    btn.style.background  = on ? 'var(--accent)' : 'none';
    btn.style.color       = on ? '#fff'           : 'var(--muted)';
  });

  try {
    const [
      { data: periodOrdersRaw },
      { data: anoOrdersRaw },
      { data: movsFromDB },
      { data: ratings },
      { data: allCustomers }
    ] = await Promise.all([
      sb.from('orders').select('id,status,total,taxa,items,mesa_num,addr,pag,phone,customer_id,created_at')
        .gte('created_at', iniISO).lt('created_at', fimISO).order('created_at', { ascending: true }),
      sb.from('orders').select('id,status,total,created_at')
        .gte('created_at', anoIn).order('created_at', { ascending: true }),
      sb.from('movimentos').select('*').order('id', { ascending: false }).limit(200),
      sb.from('ratings').select('*').order('created_at', { ascending: false }),
      fetch('/api/clientes-gestor', { headers: { 'Content-Type':'application/json', 'x-tenant-id': (() => { try { return JSON.parse(sessionStorage.getItem('sys_session')||'{}').tenant_id||'' } catch{return''} })() } }).then(r=>r.ok?r.json():[]).then(d=>({data:d})).catch(()=>({data:[]}))
    ]);

    const mesPedidos = periodOrdersRaw || [];
    const mesValidos = mesPedidos.filter(o => o.status !== 'cancelado' && o.status !== 'aguardando_pix' && o.status !== 'aguardando_cartao');
    const allYear    = anoOrdersRaw || [];

    // ─── KPIs ───────────────────────────────────────────
    const fatMes    = mesValidos.reduce((s,o) => s + parseFloat(o.total||0) + parseFloat(o.taxa||0), 0);
    const qtdMes    = mesPedidos.length;
    const ticket    = mesValidos.length > 0 ? fatMes / mesValidos.length : 0;
    const cancelMes = mesPedidos.filter(o => o.status === 'cancelado').length;
    const pctCancel = qtdMes > 0 ? (cancelMes/qtdMes*100).toFixed(1) : '0';

    elv('rel-kpi-fat',        moneyK(fatMes));
    elv('rel-kpi-fat-sub',    mesValidos.length + ' pedidos confirmados ' + periLabel);
    elv('rel-kpi-ped',        qtdMes);
    elv('rel-kpi-ped-sub',    mesValidos.length + ' confirmados · ' + cancelMes + ' cancelados');
    elv('rel-kpi-ticket',     money(ticket));
    elv('rel-kpi-cancel',     cancelMes);
    elv('rel-kpi-cancel-sub', pctCancel + '% do total de pedidos');

    // Trends (compara com período anterior simples — positivo/negativo por ticket)
    const trendFat  = document.getElementById('rel-kpi-fat-trend');
    const trendPed  = document.getElementById('rel-kpi-ped-trend');
    if (trendFat) trendFat.innerHTML = fatMes>0
      ? `<span style="color:var(--success)">↑ ${pct(mesValidos.length,qtdMes||1)} confirmação</span>`
      : '<span style="color:var(--muted)">Sem dados</span>';
    if (trendPed) trendPed.innerHTML = mesValidos.length > 0
      ? `<span style="color:var(--success)">✓ ${mesValidos.length} pedidos válidos</span>`
      : '<span style="color:var(--muted)">Sem pedidos confirmados</span>';

    // ─── Gráfico de linha (SVG) ─────────────────────────
    const lineEl = document.getElementById('rel-line-chart');
    if (lineEl) {
      const titleEl = document.getElementById('rel-chart-title');
      let points = [], labels = [], granLabel = '';
      if (_relPeriodo === 'anual') {
        granLabel = 'Faturamento mensal';
        points = new Array(12).fill(0);
        labels = ['J','F','M','A','M','J','J','A','S','O','N','D'];
        allYear.filter(o=>o.status!=='cancelado').forEach(o=>{
          points[new Date(o.created_at).getMonth()] += parseFloat(o.total||0);
        });
      } else if (_relPeriodo === 'mensal') {
        granLabel = 'Faturamento por semana';
        const semanas = Math.ceil(new Date(now.getFullYear(),now.getMonth()+1,0).getDate()/7);
        points = new Array(semanas).fill(0);
        labels = points.map((_,i)=>'S'+(i+1));
        mesValidos.forEach(o=>{
          const w = Math.min(Math.floor((new Date(o.created_at).getDate()-1)/7), semanas-1);
          points[w] += parseFloat(o.total||0) + parseFloat(o.taxa||0);
        });
      } else if (_relPeriodo === 'semanal') {
        granLabel = 'Faturamento por dia';
        labels = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        points = new Array(7).fill(0);
        mesValidos.forEach(o=>{ points[new Date(o.created_at).getDay()] += parseFloat(o.total||0)+parseFloat(o.taxa||0); });
      } else {
        granLabel = 'Faturamento por hora';
        points = new Array(24).fill(0);
        labels = Array.from({length:24},(_,i)=>i%6===0?i+'h':'');
        mesValidos.forEach(o=>{ points[new Date(o.created_at).getHours()] += parseFloat(o.total||0)+parseFloat(o.taxa||0); });
      }
      if (titleEl) titleEl.textContent = granLabel;

      const maxP = Math.max(...points, 1);
      const W=580, H=140, pad=10, botPad=24, topPad=10;
      const n = points.length;
      const xStep = (W-pad*2)/(n-1||1);
      const toX = i => pad + i*xStep;
      const toY = v => topPad + (H-botPad-topPad)*(1-v/maxP);
      const pathD = points.map((v,i) => (i===0?'M':'L')+toX(i).toFixed(1)+','+toY(v).toFixed(1)).join(' ');
      const areaD = pathD + ` L${toX(n-1).toFixed(1)},${H-botPad} L${pad},${H-botPad} Z`;

      lineEl.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="lg1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#3b82f6" stop-opacity=".4"/>
            <stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/>
          </linearGradient>
        </defs>
        ${points.map((_,i) => i%Math.max(1,Math.floor(n/5))===0 ? `<line x1="${toX(i).toFixed(1)}" y1="${topPad}" x2="${toX(i).toFixed(1)}" y2="${H-botPad}" stroke="rgba(255,255,255,.04)" stroke-width="1"/>` : '').join('')}
        <path d="${areaD}" fill="url(#lg1)"/>
        <path d="${pathD}" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${points.map((v,i)=> v>0 ? `<circle cx="${toX(i).toFixed(1)}" cy="${toY(v).toFixed(1)}" r="3" fill="#3b82f6"/>
          <text x="${toX(i).toFixed(1)}" y="${(toY(v)-6).toFixed(1)}" font-size="8" text-anchor="middle" fill="#94a3b8">${v>=1000?Math.round(v/1000)+'k':'R$'+Math.round(v)}</text>` : '').join('')}
        ${labels.map((l,i)=> l ? `<text x="${toX(i).toFixed(1)}" y="${H-4}" font-size="9" text-anchor="middle" fill="#64748b">${l}</text>` : '').join('')}
      </svg>`;
    }

    // ─── Pedidos por hora ───────────────────────────────
    const hourCounts = new Array(24).fill(0);
    mesPedidos.forEach(o => { hourCounts[new Date(o.created_at).getHours()]++; });
    const maxH = Math.max(...hourCounts, 1);
    const hourEl = document.getElementById('rel-hour-bar');
    if (hourEl) hourEl.innerHTML = hourCounts.map((v,i)=>`
      <div class="bar-col">
        <div class="bar-val" style="font-size:8px">${v>0?v:''}</div>
        <div class="bar-fill" style="height:${Math.max(Math.round(v/maxH*100),v>0?4:1)}%;background:${v===Math.max(...hourCounts)?'var(--orange)':'var(--accent2)'};${v===0?'opacity:.15':''}"></div>
        <div class="bar-label" style="font-size:8px">${i%4===0?i+'h':''}</div>
      </div>`).join('');

    // ─── Dias da semana ─────────────────────────────────
    const dayC = [0,0,0,0,0,0,0];
    mesPedidos.forEach(o=>{ dayC[new Date(o.created_at).getDay()]++; });
    const maxDy = Math.max(...dayC, 1);
    const dayEl = document.getElementById('rel-day-bar');
    if (dayEl) dayEl.innerHTML = DAYS_FULL.map((d,i)=>`
      <div class="bar-col">
        <div class="bar-val">${dayC[i]}</div>
        <div class="bar-fill" style="height:${Math.max(Math.round(dayC[i]/maxDy*100),2)}%;background:${dayC[i]===Math.max(...dayC)?'var(--success)':'var(--accent3)'}"></div>
        <div class="bar-label">${d}</div>
      </div>`).join('');

    // ─── Heatmap hora × dia ─────────────────────────────
    const hmEl = document.getElementById('rel-heatmap');
    if (hmEl) {
      const hm = Array.from({length:7},()=>new Array(24).fill(0));
      mesPedidos.forEach(o=>{
        const d=new Date(o.created_at);
        hm[d.getDay()][d.getHours()]++;
      });
      const maxHM = Math.max(...hm.flat(), 1);
      const dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
      hmEl.innerHTML = `<table style="border-collapse:collapse;font-size:9px;width:100%">
        <tr><td style="color:var(--muted);padding:2px 6px"></td>${Array.from({length:24},(_,h)=>`<td style="text-align:center;color:var(--muted);padding:1px 1px;width:3.8%">${h%4===0?h+'h':''}</td>`).join('')}</tr>
        ${dias.map((dia,d)=>`<tr>
          <td style="color:var(--muted2);padding:2px 6px;white-space:nowrap;font-size:9.5px;font-weight:600">${dia}</td>
          ${hm[d].map(v=>{
            const ratio = v/maxHM;
            const bg = ratio===0 ? 'rgba(255,255,255,.04)' :
              ratio<.25 ? 'rgba(59,130,246,.25)' :
              ratio<.5  ? 'rgba(59,130,246,.55)' :
              ratio<.75 ? 'rgba(249,115,22,.6)'  : 'rgba(239,68,68,.8)';
            return `<td title="${v} pedidos" style="background:${bg};border:1px solid rgba(0,0,0,.2);border-radius:2px;height:16px"></td>`;
          }).join('')}
        </tr>`).join('')}
        <tr><td></td><td colspan="24"><div style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:9px;color:var(--muted)">
          <span>Baixo</span>
          <div style="width:12px;height:10px;background:rgba(59,130,246,.25);border-radius:2px"></div>
          <div style="width:12px;height:10px;background:rgba(59,130,246,.55);border-radius:2px"></div>
          <div style="width:12px;height:10px;background:rgba(249,115,22,.6);border-radius:2px"></div>
          <div style="width:12px;height:10px;background:rgba(239,68,68,.8);border-radius:2px"></div>
          <span>Alto</span>
        </div></td></tr>
      </table>`;
    }

    // ─── Gráfico de barras anual ────────────────────────
    const mbEl = document.getElementById('rel-month-bar');
    const mTitle = document.getElementById('rel-month-title');
    if (mbEl) {
      const monthData = new Array(12).fill(0);
      allYear.filter(o=>o.status!=='cancelado').forEach(o=>{
        monthData[new Date(o.created_at).getMonth()] += parseFloat(o.total||0);
      });
      const maxMB = Math.max(...monthData, 1);
      const mNames = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      mbEl.innerHTML = monthData.map((v,i)=>`
        <div class="bar-col">
          <div class="bar-val" style="font-size:9px">${v>0?'R$'+Math.round(v/1000)+'k':''}</div>
          <div class="bar-fill" style="height:${Math.max(Math.round(v/maxMB*100),v>0?3:1)}%;${v===0?'opacity:.15':''}"></div>
          <div class="bar-label">${mNames[i]}</div>
        </div>`).join('');
      if (mTitle) mTitle.textContent = 'Faturamento mensal '+now.getFullYear();
    }

    // ─── Pagamentos ─────────────────────────────────────
    const pagMap = {};
    mesValidos.forEach(o=>{
      const k = (o.pag||'outro').toLowerCase().includes('pix')   ? 'PIX'
              : (o.pag||'').toLowerCase().includes('cart')        ? 'Cartão'
              : (o.pag||'').toLowerCase().includes('dinheiro')    ? 'Dinheiro'
              : (o.pag||'').toLowerCase().includes('mesa')        ? 'Mesa'
              : (o.pag||'outro');
      if (!pagMap[k]) pagMap[k] = {count:0, fat:0};
      pagMap[k].count++; pagMap[k].fat += parseFloat(o.total||0)+parseFloat(o.taxa||0);
    });
    const pagCols = { PIX:'var(--purple)', Cartão:'var(--accent)', Dinheiro:'var(--success)', Mesa:'var(--accent3)' };
    const pagEmojis = { PIX:'💠', Cartão:'💳', Dinheiro:'💵', Mesa:'🪑' };
    const pagEl = document.getElementById('rel-gauges');
    if (pagEl) {
      const ents = Object.entries(pagMap).sort((a,b)=>b[1].count-a[1].count);
      const totPag = ents.reduce((s,[,v])=>s+v.count,0)||1;
      pagEl.innerHTML = ents.length ? ents.map(([k,v])=>`
        <div style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
            <div style="display:flex;align-items:center;gap:7px">
              <span style="font-size:16px">${''}</span>
              <span style="font-size:13px;font-weight:600">${k}</span>
            </div>
            <div style="text-align:right">
              <span style="font-size:13px;font-weight:700;color:${pagCols[k]||'var(--accent)'}">${v.count} pedidos</span>
              <span style="font-size:11px;color:var(--muted);margin-left:6px">${money(v.fat)}</span>
            </div>
          </div>
          <div style="height:7px;background:var(--border);border-radius:99px;overflow:hidden">
            <div style="height:100%;width:${pct(v.count,totPag)};background:${pagCols[k]||'var(--accent)'};border-radius:99px;transition:width .5s"></div>
          </div>
          <div style="font-size:10px;color:var(--muted);margin-top:3px">${pct(v.count,totPag)} dos pedidos</div>
        </div>`).join('')
        : '<div style="color:var(--muted);font-size:12px;padding:12px">Sem dados no período</div>';
    }

    // ─── Receita por pagamento (financeiro) ─────────────
    const fatPagEl = document.getElementById('rel-fat-pag');
    if (fatPagEl) {
      const ents = Object.entries(pagMap).sort((a,b)=>b[1].fat-a[1].fat);
      const maxFP = Math.max(...ents.map(([,v])=>v.fat), 1);
      fatPagEl.innerHTML = ents.length ? ents.map(([k,v])=>`
        <div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;margin-bottom:5px">
            <span style="font-size:12.5px;font-weight:600">${''} ${k}</span>
            <span style="font-size:13px;font-weight:700;color:${pagCols[k]||'var(--accent)'}">${money(v.fat)}</span>
          </div>
          <div style="height:8px;background:var(--border);border-radius:99px;overflow:hidden">
            <div style="height:100%;width:${Math.round(v.fat/maxFP*100)}%;background:${pagCols[k]||'var(--accent)'};border-radius:99px"></div>
          </div>
        </div>`).join('')
        : '<div style="color:var(--muted);font-size:12px;padding:12px">Sem dados</div>';
    }

    // ─── Origem (plataforma) ─────────────────────────────
    const originMap = {};
    mesValidos.forEach(o=>{
      const ori = o.mesa_num || (o.addr||'').startsWith('Mesa') ? '🪑 Mesa (Garçom)'
                : (o.addr||'').toLowerCase().includes('balc')   ? '🏪 Balcão / Retirada'
                :                                                  '🛵 Delivery';
      if(!originMap[ori]) originMap[ori]={count:0,fat:0};
      originMap[ori].count++; originMap[ori].fat+=parseFloat(o.total||0)+parseFloat(o.taxa||0);
    });
    const peEl = document.getElementById('rel-platforms');
    if (peEl) {
      const ents = Object.entries(originMap).sort((a,b)=>b[1].fat-a[1].fat);
      const maxOF = Math.max(...ents.map(([,v])=>v.fat),1);
      peEl.innerHTML = ents.length ? ents.map(([k,v])=>`
        <div style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
            <span style="font-size:13px;font-weight:600">${k}</span>
            <div style="text-align:right">
              <span style="font-size:13px;font-weight:700;color:var(--accent)">${money(v.fat)}</span>
              <span style="font-size:11px;color:var(--muted);margin-left:5px">${v.count} ped.</span>
            </div>
          </div>
          <div style="height:7px;background:var(--border);border-radius:99px;overflow:hidden">
            <div style="height:100%;width:${Math.round(v.fat/maxOF*100)}%;background:var(--accent);border-radius:99px"></div>
          </div>
        </div>`).join('')
        : '<div style="color:var(--muted);font-size:12px;padding:8px">Sem pedidos no período</div>';
    }

    // ─── Top bairros ─────────────────────────────────────
    const areaMap = {};
    mesValidos.filter(o=>!o.mesa_num&&o.addr&&!o.addr.startsWith('Mesa')).forEach(o=>{
      const parts = (o.addr||'').split(',');
      const bairro = (parts[1]||parts[0]||'').trim().split(' ').slice(0,3).join(' ') || 'Não informado';
      if(!areaMap[bairro]) areaMap[bairro]={fat:0,ped:0};
      areaMap[bairro].fat+=parseFloat(o.total||0); areaMap[bairro].ped++;
    });
    const aeEl = document.getElementById('rel-areas');
    if (aeEl) {
      const ents = Object.entries(areaMap).sort((a,b)=>b[1].ped-a[1].ped).slice(0,6);
      aeEl.innerHTML = ents.length ? ents.map(([k,v],i)=>`
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:13px;font-weight:800;color:var(--accent);width:20px">#${i+1}</span>
          <div style="flex:1">
            <div style="font-weight:600;font-size:12.5px">${k}</div>
            <div style="font-size:11px;color:var(--muted)">${v.ped} pedido${v.ped!==1?'s':''}</div>
          </div>
          <div style="font-size:12.5px;font-weight:700;color:var(--success)">${money(v.fat)}</div>
        </div>`).join('')
        : '<div style="color:var(--muted);font-size:12px;padding:8px">Apenas pedidos de mesa</div>';
    }

    // ─── Produtos mais vendidos ─────────────────────────
    const itemMap = {};
    mesValidos.forEach(o=>{
      (Array.isArray(o.items)?o.items:[]).forEach(i=>{
        const k=i.name||'?';
        if(!itemMap[k]) itemMap[k]={qty:0,fat:0,cat:i.cat||''};
        itemMap[k].qty+=(i.qty||1);
        itemMap[k].fat+=parseFloat(i.price||0)*(i.qty||1);
      });
    });
    const sortedQty = Object.entries(itemMap).sort((a,b)=>b[1].qty-a[1].qty).slice(0,12);
    const sortedFat = Object.entries(itemMap).sort((a,b)=>b[1].fat-a[1].fat).slice(0,12);
    const totalQty  = sortedQty.reduce((s,[,v])=>s+v.qty,0)||1;
    const totalFat  = sortedFat.reduce((s,[,v])=>s+v.fat,0)||1;

    const renderProdList = (sorted, field, total, color) => sorted.map(([name,v],idx)=>{
      const mi = items.find(i=>i.name===name);
      return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <span style="width:18px;font-size:11.5px;font-weight:700;color:var(--muted)">${idx+1}</span>
        <span style="font-size:17px">${mi?.emoji||'🍽️'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div>
          <div style="height:4px;background:var(--border);border-radius:99px;margin-top:4px;overflow:hidden">
            <div style="height:100%;width:${Math.round(v[field]/total*100)}%;background:${color};border-radius:99px"></div>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          ${field==='qty'
            ? `<div style="font-size:13px;font-weight:700;color:${color}">${v.qty}x</div><div style="font-size:11px;color:var(--muted)">${money(v.fat)}</div>`
            : `<div style="font-size:13px;font-weight:700;color:${color}">${money(v.fat)}</div><div style="font-size:11px;color:var(--muted)">${v.qty}x vendidos</div>`}
        </div>
      </div>`;
    }).join('');

    const rpl = document.getElementById('rel-produtos-list');
    if (rpl) rpl.innerHTML = sortedQty.length ? renderProdList(sortedQty,'qty',totalQty,'var(--accent)')
      : '<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center">Sem vendas no período</div>';

    const rpf = document.getElementById('rel-produtos-fat');
    if (rpf) rpf.innerHTML = sortedFat.length ? renderProdList(sortedFat,'fat',totalFat,'var(--success)')
      : '<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center">Sem vendas no período</div>';

    // ─── Faturamento por categoria ───────────────────────
    const catMap = {};
    mesValidos.forEach(o=>{
      (Array.isArray(o.items)?o.items:[]).forEach(i=>{
        const k = i.cat || i.cat_key || 'Outros';
        if(!catMap[k]) catMap[k]={fat:0,qty:0};
        catMap[k].fat+=parseFloat(i.price||0)*(i.qty||1);
        catMap[k].qty+=(i.qty||1);
      });
    });
    const catEnt = Object.entries(catMap).sort((a,b)=>b[1].fat-a[1].fat);
    const maxCF  = Math.max(...catEnt.map(([,v])=>v.fat),1);
    const catColors = ['var(--accent)','var(--success)','var(--purple)','var(--accent3)','var(--accent2)','var(--orange)'];
    const catEl  = document.getElementById('rel-cats-bar');
    if (catEl) catEl.innerHTML = catEnt.length ? catEnt.map(([k,v],i)=>`
      <div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
          <span style="font-size:12.5px;font-weight:600">${k}</span>
          <div>
            <span style="font-size:13px;font-weight:700;color:${catColors[i%catColors.length]}">${money(v.fat)}</span>
            <span style="font-size:11px;color:var(--muted);margin-left:6px">${v.qty} itens</span>
          </div>
        </div>
        <div style="height:9px;background:var(--border);border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${Math.round(v.fat/maxCF*100)}%;background:${catColors[i%catColors.length]};border-radius:99px;transition:width .6s"></div>
        </div>
      </div>`).join('')
      : '<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center">Sem vendas no período</div>';

    // ─── Clientes ────────────────────────────────────────
    const cliAll  = allCustomers || [];
    const limite30 = new Date(now - 30*86400000).toISOString();
    const cliTotal   = cliAll.length;
    const cliComPed  = cliAll.filter(c=>(c.orders_count||0)>0).length;
    const cliFid     = fidClients.length;
    const cliInativos= cliAll.filter(c=>c.last_order_at && c.last_order_at<limite30 && (c.orders_count||0)>0).length;
    elv('rel-cli-total',    cliTotal);
    elv('rel-cli-com-pedido', cliComPed);
    elv('rel-cli-fid',      cliFid);
    elv('rel-cli-inativos', cliInativos);

    // Top frequentes
    const topFreq = [...cliAll].sort((a,b)=>(b.orders_count||0)-(a.orders_count||0)).slice(0,8);
    const rtcEl = document.getElementById('rel-top-clients');
    if (rtcEl) rtcEl.innerHTML = topFreq.length ? topFreq.map((c,i)=>`
      <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:13px;font-weight:800;color:var(--accent);width:20px">#${i+1}</span>
        <div class="fid-av" style="width:30px;height:30px;min-width:30px;font-size:12px">${(c.name||'?')[0].toUpperCase()}</div>
        <div style="flex:1">
          <div style="font-weight:600;font-size:12.5px">${c.name||'—'}</div>
          <div style="font-size:11px;color:var(--muted)">${c.phone||''}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:13px;font-weight:700;color:var(--accent)">${c.orders_count||0} pedidos</div>
          <div style="font-size:11px;color:var(--success)">${money(c.total_spent||0)}</div>
        </div>
      </div>`).join('')
      : '<div style="color:var(--muted);font-size:12px;padding:12px">Nenhum cliente com pedidos</div>';

    // Top gastadores
    const topGasto = [...cliAll].sort((a,b)=>(b.total_spent||0)-(a.total_spent||0)).slice(0,8);
    const tgEl = document.getElementById('rel-top-gastos');
    if (tgEl) tgEl.innerHTML = topGasto.length ? topGasto.map((c,i)=>`
      <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:13px;font-weight:800;color:var(--success);width:20px">#${i+1}</span>
        <div class="fid-av" style="width:30px;height:30px;min-width:30px;font-size:12px">${(c.name||'?')[0].toUpperCase()}</div>
        <div style="flex:1">
          <div style="font-weight:600;font-size:12.5px">${c.name||'—'}</div>
          <div style="font-size:11px;color:var(--muted)">${c.orders_count||0} pedidos</div>
        </div>
        <div style="font-size:14px;font-weight:800;color:var(--success)">${money(c.total_spent||0)}</div>
      </div>`).join('')
      : '<div style="color:var(--muted);font-size:12px;padding:12px">Nenhum cliente com gastos</div>';

    // Novos clientes no período
    const novos = cliAll.filter(c=>c.created_at>=iniISO&&c.created_at<fimISO);
    const ncEl = document.getElementById('rel-novos-clientes');
    if (ncEl) ncEl.innerHTML = novos.length
      ? `<div style="margin-bottom:12px;font-size:13px;color:var(--success);font-weight:700">✨ ${novos.length} novo${novos.length!==1?'s':''} cliente${novos.length!==1?'s':''} cadastrado${novos.length!==1?'s':''} ${periLabel}</div>`
        + novos.slice(0,10).map(c=>`<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)">
          <div class="fid-av" style="width:28px;height:28px;min-width:28px;font-size:11px">${(c.name||'?')[0].toUpperCase()}</div>
          <div style="flex:1"><div style="font-size:12.5px;font-weight:600">${c.name||'—'}</div><div style="font-size:11px;color:var(--muted)">${c.phone||''}</div></div>
          <div style="font-size:11px;color:var(--muted)">${new Date(c.created_at).toLocaleDateString('pt-BR')}</div>
        </div>`).join('')
      : '<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center">Nenhum cliente cadastrado '+periLabel+'</div>';

    // ─── Financeiro: movimentos ───────────────────────────
    // movimentos.time usa formato SQLite 'YYYY-MM-DD HH:MM:SS' — normaliza para ISO
    const normDate = s => s ? new Date(s.replace(' ', 'T')) : null;
    const movsFiltrados = (movsFromDB||[]).filter(m=>{
      const t = normDate(m.created_at||m.time);
      return t && t >= range.inicio && t < range.fim;
    });
    const totEnt = movsFiltrados.filter(m=>m.tipo==='entrada').reduce((s,m)=>s+parseFloat(m.val||0),0);
    const totSai = movsFiltrados.filter(m=>m.tipo==='saida').reduce((s,m)=>s+parseFloat(m.val||0),0);
    const saldo  = totEnt - totSai;

    elv('rel-fin-entradas', money(totEnt));
    elv('rel-fin-saidas',   money(totSai));
    const saldoEl = document.getElementById('rel-fin-saldo');
    if (saldoEl) { saldoEl.textContent = money(saldo); saldoEl.style.color = saldo>=0?'var(--success)':'var(--danger)'; }

    const movEl = document.getElementById('rel-entradas-list');
    if (movEl) movEl.innerHTML = movsFiltrados.length
      ? movsFiltrados.slice(0,30).map(m=>`
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="width:26px;height:26px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:13px;
            background:${m.tipo==='entrada'?'rgba(34,197,94,.12)':'rgba(239,68,68,.12)'}">
            ${m.tipo==='entrada'?'↑':'↓'}
          </div>
          <div style="flex:1">
            <div style="font-size:12.5px;font-weight:500">${m.description||'—'}</div>
            <div style="font-size:11px;color:var(--muted)">${m.pag||''} ${m.time||m.created_at?'· '+new Date(m.created_at||m.time).toLocaleDateString('pt-BR'):''}</div>
          </div>
          <div style="font-weight:700;font-size:13px;color:${m.tipo==='entrada'?'var(--success)':'var(--danger)'}">
            ${m.tipo==='entrada'?'+':'-'}${money(m.val)}
          </div>
        </div>`).join('')
      : '<div style="color:var(--muted);font-size:12px;padding:16px;text-align:center">Nenhuma movimentação no período</div>';

    // ─── Satisfação ───────────────────────────────────────
    const ratList = ratings || [];
    const ratPeriodo = ratList.filter(r=>r.created_at>=iniISO);
    const satResumoEl = document.getElementById('rel-sat-resumo');
    if (satResumoEl) {
      if (!ratList.length) {
        satResumoEl.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center">Nenhuma avaliação recebida</div>';
      } else {
        const media = ratList.reduce((s,r)=>s+(r.nota||5),0) / ratList.length;
        const dist  = [5,4,3,2,1].map(n=>({ nota:n, count:ratList.filter(r=>(r.nota||5)===n).length }));
        satResumoEl.innerHTML = `
          <div style="text-align:center;margin-bottom:16px">
            <div style="font-size:42px;font-weight:900;color:var(--accent3)">${media.toFixed(1)}</div>
            <div style="margin-bottom:6px">${''}</div>
            <div style="font-size:12px;color:var(--muted)">${ratList.length} avaliações</div>
          </div>
          ${dist.map(({nota,count})=>`
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:12px;color:var(--muted);width:12px">${nota}</span>
              <div style="flex:1;height:7px;background:var(--border);border-radius:99px;overflow:hidden">
                <div style="height:100%;width:${ratList.length?Math.round(count/ratList.length*100):0}%;background:var(--accent3);border-radius:99px"></div>
              </div>
              <span style="font-size:11px;color:var(--muted);width:24px">${count}</span>
            </div>`).join('')}`;
      }
    }
    const satListEl = document.getElementById('rel-sat-list');
    if (satListEl) satListEl.innerHTML = ratList.length
      ? ratList.slice(0,20).map(r=>`
        <div style="padding:12px;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
            <div style="font-weight:600;font-size:12.5px">${r.client||'Anônimo'}</div>
            <div>
              <span style="font-size:13px">${''}</span>
              <span style="font-size:11px;color:var(--muted);margin-left:6px">${r.created_at?new Date(r.created_at).toLocaleDateString('pt-BR'):''}</span>
            </div>
          </div>
          ${r.comentario?`<div style="font-size:12px;color:var(--muted2);font-style:italic">"${r.comentario}"</div>`:''}
        </div>`).join('')
      : '<div style="color:var(--muted);font-size:12px;padding:16px;text-align:center">Nenhuma avaliação com comentário</div>';

  } catch(e) {
    console.error('renderRelatorios error:', e);
    sbToast('err', 'Erro ao carregar relatórios: ' + e.message);
  }
}

function relExportar() {
  const range = _relGetRange();
  const rows  = [['Período', range.label], ['Gerado em', new Date().toLocaleString('pt-BR')]];
  const csv   = rows.map(r=>r.join(';')).join('\n');
  const a     = document.createElement('a');
  a.href      = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download  = 'relatorio-' + _relPeriodo + '.csv';
  a.click();
  sbToast('ok', 'CSV exportado!');
}


// ─────────────────────────────────────────
// SATISFAÇÃO
// ─────────────────────────────────────────
async function renderSatisfacao(){
  const elBars    = document.getElementById('sat-bars');
  const elReviews = document.getElementById('sat-reviews');

  if (elBars)    elBars.innerHTML    = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:12px">Carregando…</div>';
  if (elReviews) elReviews.innerHTML = '';

  try {
    const { data: ratings, error } = await sb.from('ratings').select('*').order('created_at', { ascending: false });
    if (error) throw error;

    const list  = ratings || [];
    const total = list.length;
    const statEls   = document.querySelectorAll('#page-satisfacao .sg .sv');
    const statTrend = document.querySelector('#page-satisfacao .sg .str');

    if (total === 0) {
      const vazio = `<div style="text-align:center;padding:40px 20px;color:var(--muted);font-size:13px">
        <div style="margin-bottom:12px;color:var(--accent3)"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M8 2l1.5 3.5L13 6l-2.5 2.5.6 3.5L8 10.5 4.9 12l.6-3.5L3 6l3.5-.5L8 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></div>
        Nenhuma avaliação ainda.<br>
        <small style="font-size:11.5px">Quando clientes responderem ao link de avaliação, os dados aparecerão aqui.</small>
      </div>`;
      if (elBars)    elBars.innerHTML    = vazio;
      if (elReviews) elReviews.innerHTML = '';
      if (statEls[0]) statEls[0].textContent = '—';
      if (statEls[1]) statEls[1].textContent = '0';
      if (statEls[2]) statEls[2].textContent = '—';
      if (statEls[3]) statEls[3].textContent = '—';
      return;
    }

    const soma          = list.reduce((s, r) => s + (r.nota || 0), 0);
    const media         = soma / total;
    const satisfeitos   = list.filter(r => r.nota >= 4).length;
    const insatisfeitos = list.filter(r => r.nota <= 2).length;

    if (statEls[0]) statEls[0].textContent = media.toFixed(1);
    if (statEls[1]) statEls[1].textContent = total;
    if (statEls[2]) statEls[2].textContent = Math.round((satisfeitos / total) * 100) + '%';
    if (statEls[3]) statEls[3].textContent = Math.round((insatisfeitos / total) * 100) + '%';
    if (statTrend)  statTrend.textContent  = media >= 4.5 ? '↑ Excelente' : media >= 3.5 ? '→ Bom' : '↓ Atenção';

    // Distribuição de notas
    const dist = [5,4,3,2,1].map(nota => {
      const count = list.filter(r => r.nota === nota).length;
      const pct   = Math.round((count / total) * 100);
      const clr   = nota >= 4 ? 'var(--success)' : nota === 3 ? '#f59e0b' : 'var(--danger)';
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-size:12px;font-weight:700;min-width:14px;text-align:right">${nota}</span>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M8 2l1.5 3.5L13 6l-2.5 2.5.6 3.5L8 10.5 4.9 12l.6-3.5L3 6l3.5-.5L8 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
        <div style="flex:1;height:9px;background:var(--surface2);border-radius:99px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${clr};border-radius:99px"></div>
        </div>
        <span style="font-size:11.5px;color:var(--muted);min-width:32px;text-align:right">${count}x</span>
      </div>`;
    }).join('');
    if (elBars) elBars.innerHTML = dist;

    // Últimas avaliações
    const EMOJI = { 5:'😍', 4:'😊', 3:'😐', 2:'😕', 1:'😠' };
    const revs = list.slice(0, 30).map(r => {
      const stars = '⭐'.repeat(r.nota || 0);
      const dt    = r.created_at
        ? new Date(r.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
        : '';
      return `<div style="padding:12px 0;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:flex-start">
        <div style="font-size:26px;flex-shrink:0;line-height:1">${EMOJI[r.nota] || '⭐'}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px">
            <span style="font-weight:700;font-size:13px">${r.client || 'Cliente'}</span>
            <span style="font-size:11px;color:var(--muted);white-space:nowrap">${dt}</span>
          </div>
          <div style="font-size:13px;margin-bottom:${r.comentario ? '5px' : '0'}">${stars}</div>
          ${r.comentario ? `<div style="font-size:12.5px;color:var(--muted2);line-height:1.5">${r.comentario}</div>` : ''}
          ${r.order_id   ? `<div style="font-size:11px;color:var(--muted);margin-top:3px">Pedido #${String(r.order_id).padStart(3,'0')}</div>` : ''}
        </div>
      </div>`;
    }).join('');
    if (elReviews) elReviews.innerHTML = revs || '<div style="color:var(--muted);font-size:12px;padding:12px">Nenhuma avaliação.</div>';

  } catch(e) {
    console.error('renderSatisfacao:', e);
    const err = '<div style="color:var(--muted);font-size:12.5px;padding:20px;text-align:center">Erro ao carregar avaliações.</div>';
    if (elBars)    elBars.innerHTML    = err;
    if (elReviews) elReviews.innerHTML = '';
  }
}

// ─────────────────────────────────────────
// MEU PLANO
// ─────────────────────────────────────────
async function renderMeuPlano() {
  const elNome   = document.getElementById('plano-nome-display');
  const elExpira = document.getElementById('plano-expira-display');
  const elDias   = document.getElementById('plano-dias-display');
  const elTenant = document.getElementById('plano-tenant-display');
  const elBadge  = document.getElementById('plano-badge-wrap');
  const elStatus = document.getElementById('plano-status-wrap');
  const elRecursos = document.getElementById('plano-recursos-grid');
  const elBgDeco = document.getElementById('plano-bg-deco');

  if (elNome) elNome.textContent = 'Carregando...';
  
  // Carregar precos dos planos
  carregarPrecosPlanos();

  try {
    const tid = _sessao?.tenant_id;
    if (!tid) throw new Error('Sessão inválida');

    const res = await fetch('/api/tenant-info-gestor', {
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid }
    });
    if (!res.ok) throw new Error('Erro HTTP ' + res.status);
    const data = await res.json();
    if (!data) throw new Error('Tenant não encontrado');

    const plano     = (data.plano || 'pro').toLowerCase();
    const isPremium = plano === 'premium';
    const expira    = data.expires_at ? new Date(data.expires_at) : null;
    const hoje      = new Date();
    hoje.setHours(0,0,0,0);
    const diasRestantes = expira
      ? Math.ceil((expira - hoje) / (1000 * 60 * 60 * 24))
      : null;

    // ── Nome e badge ──
    const planoLabel = isPremium ? 'Premium' : 'Pro';
    const planoColor = isPremium ? '#7c3aed' : 'var(--accent)';
    if (elNome)   { elNome.textContent = planoLabel; elNome.style.color = planoColor; }
    if (elBgDeco) elBgDeco.style.background = planoColor;
    if (elBadge)  elBadge.innerHTML = `
      <div style="padding:4px 12px;border-radius:99px;font-size:11px;font-weight:800;letter-spacing:.4px;
        background:${isPremium ? 'rgba(124,58,237,.15)' : 'rgba(59,130,246,.12)'};
        color:${planoColor};border:1px solid ${isPremium ? 'rgba(124,58,237,.35)' : 'rgba(59,130,246,.3)'}">
        ${planoLabel.toUpperCase()}
      </div>`;

    // ── Vencimento ──
    const expiraStr = expira
      ? expira.toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' })
      : 'Sem data definida';
    if (elExpira) elExpira.textContent = expiraStr;

    // ── Dias restantes ──
    let diasStr = 'Sem data definida';
    let diasColor = 'var(--text)';
    if (diasRestantes !== null) {
      if (diasRestantes > 30)       { diasStr = `${diasRestantes} dias`; diasColor = 'var(--success)'; }
      else if (diasRestantes > 7)   { diasStr = `${diasRestantes} dias`; diasColor = 'var(--warning,#f59e0b)'; }
      else if (diasRestantes > 0)   { diasStr = `${diasRestantes} dias — vence em breve`; diasColor = 'var(--danger)'; }
      else if (diasRestantes === 0) { diasStr = 'Vence hoje'; diasColor = 'var(--danger)'; }
      else                          { diasStr = 'Vencido'; diasColor = 'var(--danger)'; }
    }
    if (elDias) { elDias.textContent = diasStr; elDias.style.color = diasColor; }

    // ── Nome do tenant ──
    if (elTenant) elTenant.textContent = data.nome || _sessao?.nome || '—';

    // ── Status ──
    if (elStatus) {
      const ativo = data.ativo !== 0 && data.ativo !== false;
      const vencido = diasRestantes !== null && diasRestantes < 0;
      const alertaBarra = diasRestantes !== null && diasRestantes <= 30 && diasRestantes >= 0;
      const pct = alertaBarra ? Math.max(0, Math.min(100, Math.round((diasRestantes / 30) * 100))) : null;

      let statusHtml = '';
      if (!ativo || vencido) {
        statusHtml += `
          <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;
            background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:10px">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="color:var(--danger);flex-shrink:0">
              <path d="M8 2L14 13H2L8 2z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M8 6v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              <circle cx="8" cy="11" r=".6" fill="currentColor"/>
            </svg>
            <div>
              <div style="font-weight:700;font-size:13px;color:var(--danger)">${vencido ? 'Plano vencido' : 'Conta inativa'}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:1px">Entre em contato com o suporte para reativar.</div>
            </div>
          </div>`;
      } else {
        statusHtml += `
          <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;
            background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:10px">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="color:var(--success);flex-shrink:0">
              <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/>
              <path d="M5.5 8l2 2 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
            <div>
              <div style="font-weight:700;font-size:13px;color:var(--success)">Assinatura ativa</div>
              <div style="font-size:12px;color:var(--muted);margin-top:1px">Todos os recursos disponíveis.</div>
            </div>
          </div>`;
      }
      if (alertaBarra && pct !== null) {
        const barColor = diasRestantes <= 7 ? 'var(--danger)' : '#f59e0b';
        statusHtml += `
          <div style="margin-top:4px">
            <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);margin-bottom:5px">
              <span>Tempo restante do plano</span>
              <span style="font-weight:700;color:${barColor}">${diasRestantes}d de 30d</span>
            </div>
            <div style="height:7px;background:var(--surface2);border-radius:99px;overflow:hidden">
              <div style="width:${pct}%;height:100%;background:${barColor};border-radius:99px;transition:width .5s"></div>
            </div>
          </div>`;
      }
      elStatus.innerHTML = statusHtml;
    }

    // ── Recursos ──
    const recursosPro = [
      { svg:'<path d="M2 2h12v12H2z" stroke="currentColor" stroke-width="1.4" fill="none" rx="2"/><path d="M5 6h6M5 9h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Gestão de pedidos (Kanban)' },
      { svg:'<rect x="1" y="4" width="14" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8.5" r="2" stroke="currentColor" stroke-width="1.4"/>', label:'PDV / Pedidos no balcão' },
      { svg:'<rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M5 8h6M8 5v6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Gestor de cardápio' },
      { svg:'<path d="M3 12V5l5-3 5 3v7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><rect x="6" y="8" width="4" height="4" rx=".5" stroke="currentColor" stroke-width="1.4"/>', label:'Mesas e garçons' },
      { svg:'<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 2c-1.5 2-2.5 3.8-2.5 6s1 4 2.5 6M2 8h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Cardápio público online' },
      { svg:'<path d="M2 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V4z" stroke="currentColor" stroke-width="1.4" fill="none"/>', label:'Automações de WhatsApp' },
      { svg:'<path d="M8 2l1.5 3.5L13 6l-2.5 2.5.6 3.5L8 10.5 4.9 12l.6-3.5L3 6l3.5-.5z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>', label:'Satisfação e avaliações' },
      { svg:'<rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/>', label:'QR Code da mesa' },
      { svg:'<path d="M2 12L6 4l3 5 2-2.5L14 12H2z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>', label:'Relatórios e desempenho' },
      { svg:'<rect x="1" y="4" width="14" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"/><rect x="3" y="2" width="10" height="4" rx="1" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="9" r="1.5" stroke="currentColor" stroke-width="1.4"/>', label:'Caixa e movimentos' },
      { svg:'<path d="M8 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM2 13c0-2.76 2.24-5 5-5h2c2.76 0 5 2.24 5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Programa de fidelidade' },
      { svg:'<rect x="3" y="2" width="10" height="4" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="3" y="10" width="10" height="4" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M3 6H2a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1M13 6h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1" stroke="currentColor" stroke-width="1.4"/>', label:'Impressão térmica' },
    ];
    const extraPremium = [
      { svg:'<rect x="3" y="5" width="10" height="8" rx="2" stroke="currentColor" stroke-width="1.4"/><circle cx="6" cy="9" r="1" fill="currentColor"/><circle cx="10" cy="9" r="1" fill="currentColor"/><path d="M6 5V3.5M10 5V3.5M6 3.5H10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Agente IA no WhatsApp', destaque: true },
      { svg:'<path d="M2 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V4z" stroke="currentColor" stroke-width="1.4"/><path d="M5 7h6M5 9.5h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Simulador do robô', destaque: true },
    ];
    const recursos = isPremium ? [...recursosPro, ...extraPremium] : recursosPro;
    if (elRecursos) {
      elRecursos.innerHTML = recursos.map(r => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;
          background:var(--surface2);border:1px solid ${r.destaque ? 'rgba(124,58,237,.3)' : 'var(--border)'};border-radius:10px;
          ${r.destaque ? 'background:rgba(124,58,237,.07);' : ''}">
          <div style="width:28px;height:28px;border-radius:7px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
            background:${r.destaque ? 'rgba(124,58,237,.15)' : 'var(--surface)'};
            border:1px solid ${r.destaque ? 'rgba(124,58,237,.25)' : 'var(--border)'};
            color:${r.destaque ? '#a78bfa' : 'var(--muted)'}">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">${r.svg}</svg>
          </div>
          <span style="font-size:12.5px;font-weight:500;color:${r.destaque ? 'var(--text)' : 'var(--muted2)'};flex:1">${r.label}</span>
          <svg viewBox="0 0 16 16" fill="none" width="12" height="12" style="flex-shrink:0;color:${r.destaque ? '#a78bfa' : 'var(--success)'}">
            ${r.destaque
              ? '<path d="M8 2l1.5 3.5L13 6l-2.5 2.5.6 3.5L8 10.5 4.9 12l.6-3.5L3 6l3.5-.5z" stroke="currentColor" stroke-width="1.3" fill="none"/>'
              : '<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 8l2 2 3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'}
          </svg>
        </div>`).join('');
    }

  } catch(e) {
    console.error('renderMeuPlano:', e);
    if (elNome) elNome.textContent = '—';
    if (elStatus) elStatus.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:12px;text-align:center">Não foi possível carregar as informações do plano.</div>`;
  }
}

// ─────────────────────────────────────────
// RENOVACAO DE PLANOS
// ─────────────────────────────────────────
let _planoSelecionado = 'premium';
let _formaPagPlano = 'pix';
let _precosPlanos = { essencial: 79.99, premium: 99.90 };
let _pixPlanoInterval = null;

async function carregarPrecosPlanos() {
  try {
    const res = await fetch('/api/planos/precos');
    if (res.ok) {
      const data = await res.json();
      _precosPlanos = { essencial: data.essencial || 79.99, premium: data.premium || 99.90 };
      const elEss = document.getElementById('preco-essencial');
      const elPre = document.getElementById('preco-premium');
      if (elEss) elEss.textContent = _precosPlanos.essencial.toFixed(2).replace('.', ',');
      if (elPre) elPre.textContent = _precosPlanos.premium.toFixed(2).replace('.', ',');
    }
  } catch(e) { console.error('carregarPrecosPlanos:', e); }
}

function selecionarPlano(plano) {
  _planoSelecionado = plano;
  const cardEss = document.getElementById('plano-card-essencial');
  const cardPre = document.getElementById('plano-card-premium');
  const dotEss = document.getElementById('plano-dot-essencial');
  const dotPre = document.getElementById('plano-dot-premium');
  const checkEss = document.getElementById('plano-check-essencial');
  const checkPre = document.getElementById('plano-check-premium');

  if (plano === 'essencial') {
    if (cardEss) { cardEss.style.borderColor = 'var(--accent)'; cardEss.style.background = 'rgba(59,130,246,.05)'; }
    if (cardPre) { cardPre.style.borderColor = 'rgba(139,92,246,.3)'; cardPre.style.background = 'linear-gradient(135deg,rgba(139,92,246,.08),rgba(236,72,153,.05))'; }
    if (dotEss) dotEss.style.background = 'var(--accent)';
    if (dotPre) dotPre.style.background = 'transparent';
    if (checkEss) checkEss.style.borderColor = 'var(--accent)';
    if (checkPre) checkPre.style.borderColor = 'rgba(139,92,246,.5)';
  } else {
    if (cardEss) { cardEss.style.borderColor = 'var(--border)'; cardEss.style.background = 'var(--surface2)'; }
    if (cardPre) { cardPre.style.borderColor = 'var(--purple)'; cardPre.style.background = 'linear-gradient(135deg,rgba(139,92,246,.12),rgba(236,72,153,.08))'; }
    if (dotEss) dotEss.style.background = 'transparent';
    if (dotPre) dotPre.style.background = 'var(--purple)';
    if (checkEss) checkEss.style.borderColor = 'var(--border)';
    if (checkPre) checkPre.style.borderColor = 'var(--purple)';
  }
}

function selecionarFormaPagPlano(forma) {
  _formaPagPlano = forma;
  const optPix = document.getElementById('pag-opt-pix');
  const optCartao = document.getElementById('pag-opt-cartao');
  if (forma === 'pix') {
    if (optPix) { optPix.style.background = 'rgba(59,130,246,.08)'; optPix.style.borderColor = 'var(--accent)'; }
    if (optCartao) { optCartao.style.background = 'var(--surface)'; optCartao.style.borderColor = 'var(--border)'; }
  } else {
    if (optPix) { optPix.style.background = 'var(--surface)'; optPix.style.borderColor = 'var(--border)'; }
    if (optCartao) { optCartao.style.background = 'rgba(59,130,246,.08)'; optCartao.style.borderColor = 'var(--accent)'; }
  }
}

async function iniciarPagamentoPlano() {
  const btn = document.getElementById('btn-pagar-plano');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Processando...'; }
  
  const planoNome = _planoSelecionado === 'essencial' ? 'Plano Essencial' : 'Plano Premium';
  const valor = _precosPlanos[_planoSelecionado];
  
  if (_formaPagPlano === 'pix') {
    try {
      const tid = _sessao?.tenant_id;
      const res = await fetch('/api/planos/pagar-pix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
        body: JSON.stringify({ plano: _planoSelecionado, valor })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao criar PIX');
      
      // Mostrar modal com QR Code
      document.getElementById('pix-plano-titulo').textContent = planoNome;
      document.getElementById('pix-plano-valor').textContent = 'R$ ' + valor.toFixed(2).replace('.', ',');
      document.getElementById('pix-plano-code').value = data.qr_code || '';
      document.getElementById('pix-plano-mp-id').value = data.mp_payment_id || '';
      
      if (data.qr_code_base64) {
        document.getElementById('pix-qr-img').innerHTML = `<img src="data:image/png;base64,${data.qr_code_base64}" style="width:200px;height:200px">`;
      } else {
        document.getElementById('pix-qr-img').innerHTML = '<div style="color:var(--muted);font-size:12px">QR Code nao disponivel.<br>Use o codigo PIX abaixo.</div>';
      }
      
      document.getElementById('modal-pag-pix-plano').classList.add('on');
      iniciarPollingPixPlano(data.mp_payment_id);
      
    } catch(e) {
      sbToast('err', e.message);
    }
  } else {
    // Cartao
    document.getElementById('cartao-plano-titulo').textContent = planoNome;
    document.getElementById('cartao-plano-valor').textContent = 'R$ ' + valor.toFixed(2).replace('.', ',');
    document.getElementById('modal-pag-cartao-plano').classList.add('on');
  }
  
  if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8h12M8 2v12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Renovar Plano'; }
}

function iniciarPollingPixPlano(mpId) {
  if (_pixPlanoInterval) clearInterval(_pixPlanoInterval);
  let checks = 0;
  _pixPlanoInterval = setInterval(async () => {
    checks++;
    if (checks > 120) { // 10 minutos
      clearInterval(_pixPlanoInterval);
      document.getElementById('pix-status-text').textContent = 'Tempo esgotado. Tente novamente.';
      return;
    }
    try {
      const res = await fetch('/api/planos/status-pix?mp_payment_id=' + mpId);
      const data = await res.json();
      if (data.status === 'aprovado') {
        clearInterval(_pixPlanoInterval);
        document.getElementById('pix-status-text').textContent = 'Pagamento confirmado!';
        document.getElementById('pix-status-text').parentElement.style.background = 'rgba(34,197,94,.1)';
        document.getElementById('pix-status-text').parentElement.style.borderColor = 'rgba(34,197,94,.3)';
        sbToast('ok', 'Pagamento confirmado! Seu plano foi renovado.');
        setTimeout(() => {
          fecharModalPagPlano();
          renderMeuPlano();
        }, 2000);
      }
    } catch(e) {}
  }, 5000);
}

function copiarPixPlano() {
  const code = document.getElementById('pix-plano-code').value;
  if (!code) { sbToast('err', 'Codigo PIX nao disponivel'); return; }
  navigator.clipboard.writeText(code).then(() => {
    sbToast('ok', 'Codigo PIX copiado!');
    const btn = document.getElementById('btn-copiar-pix-plano');
    if (btn) { btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8l4 4 8-8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Copiado!'; }
  });
}

function fecharModalPagPlano() {
  document.getElementById('modal-pag-pix-plano')?.classList.remove('on');
  document.getElementById('modal-pag-cartao-plano')?.classList.remove('on');
  if (_pixPlanoInterval) { clearInterval(_pixPlanoInterval); _pixPlanoInterval = null; }
}

function formatarCartao(el) {
  let v = el.value.replace(/\D/g, '');
  v = v.replace(/(\d{4})(?=\d)/g, '$1 ');
  el.value = v.substring(0, 19);
}

function formatarValidade(el) {
  let v = el.value.replace(/\D/g, '');
  if (v.length >= 2) v = v.substring(0,2) + '/' + v.substring(2);
  el.value = v.substring(0, 5);
}

function formatarCPF(el) {
  let v = el.value.replace(/\D/g, '');
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  el.value = v.substring(0, 14);
}

let _mpPlanoInstance = null;

async function carregarMPSDKPlano() {
  if (_mpPlanoInstance) return _mpPlanoInstance;
  // Carrega SDK se ainda nao carregado
  if (!window.MercadoPago) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://sdk.mercadopago.com/js/v2';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  // Busca public key
  const res = await fetch('/api/planos/mp-public-key');
  const data = await res.json();
  if (!data.public_key) throw new Error('Public Key do Mercado Pago nao configurada no Admin');
  _mpPlanoInstance = new MercadoPago(data.public_key);
  return _mpPlanoInstance;
}

async function processarPagamentoCartao() {
  const btn = document.getElementById('btn-pagar-cartao-plano');
  const numero = document.getElementById('cartao-numero').value.replace(/\s/g, '');
  const validade = document.getElementById('cartao-validade').value;
  const cvv = document.getElementById('cartao-cvv').value;
  const nome = document.getElementById('cartao-nome').value;
  const cpf = document.getElementById('cartao-cpf').value.replace(/\D/g, '');
  const email = document.getElementById('cartao-email')?.value || 'cliente@email.com';
  
  if (!numero || numero.length < 13) { sbToast('err', 'Numero do cartao invalido'); return; }
  if (!validade || validade.length < 5) { sbToast('err', 'Validade invalida'); return; }
  if (!cvv || cvv.length < 3) { sbToast('err', 'CVV invalido'); return; }
  if (!nome) { sbToast('err', 'Nome no cartao obrigatorio'); return; }
  if (!cpf || cpf.length < 11) { sbToast('err', 'CPF invalido'); return; }
  
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Processando...'; }
  
  try {
    // Carrega SDK do Mercado Pago
    const mp = await carregarMPSDKPlano();
    
    const [mes, ano] = validade.split('/');
    
    // Cria card token usando SDK
    const cardToken = await mp.createCardToken({
      cardNumber: numero,
      cardholderName: nome,
      cardExpirationMonth: mes,
      cardExpirationYear: '20' + ano,
      securityCode: cvv,
      identificationType: 'CPF',
      identificationNumber: cpf
    });
    
    if (!cardToken?.id) throw new Error('Erro ao gerar token do cartao');
    
    // Detecta bandeira do cartao
    let paymentMethodId = 'visa';
    try {
      const bin = numero.substring(0, 6);
      const pmRes = await fetch(`https://api.mercadopago.com/v1/payment_methods/search?bin=${bin}&site_id=MLB`);
      const pmData = await pmRes.json();
      if (pmData.results?.[0]?.id) paymentMethodId = pmData.results[0].id;
    } catch {}
    
    const tid = _sessao?.tenant_id;
    const res = await fetch('/api/planos/pagar-cartao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({
        plano: _planoSelecionado,
        valor: _precosPlanos[_planoSelecionado],
        card_token: cardToken.id,
        payment_method_id: paymentMethodId,
        payer_email: email,
        payer_cpf: cpf
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao processar pagamento');
    
    if (data.status === 'aprovado') {
      sbToast('ok', 'Pagamento aprovado! Seu plano foi renovado.');
      fecharModalPagPlano();
      renderMeuPlano();
    } else if (data.status === 'pendente') {
      sbToast('ok', 'Pagamento em analise. Aguarde confirmacao.');
    } else {
      throw new Error(data.status_detail || 'Pagamento recusado');
    }
  } catch(e) {
    sbToast('err', e.message);
  }
  
  if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8l4 4 8-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Pagar agora'; }
}

// Inicializar selecao padrao
setTimeout(() => {
  selecionarPlano('premium');
  carregarPrecosPlanos();
}, 100);

