// ─────────────────────────────────────────
// GESTOR — DRAG & DROP CATEGORIAS
// ─────────────────────────────────────────
let _dragCatId = null;

function catDragStart(e, id) {
  _dragCatId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
  // Mark dragging element
  setTimeout(() => e.target.closest('.cat-row')?.classList.add('dragging'), 0);
}

function catDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  // Highlight drop target
  const row = e.target.closest('.cat-row');
  document.querySelectorAll('.cat-row.drag-over').forEach(r => r.classList.remove('drag-over'));
  if (row && parseInt(row.dataset.catId) !== _dragCatId) {
    row.classList.add('drag-over');
  }
}

function catDragEnd(e) {
  document.querySelectorAll('.cat-row').forEach(r => {
    r.classList.remove('dragging');
    r.classList.remove('drag-over');
  });
  _dragCatId = null;
}

async function catDrop(e, targetId) {
  e.preventDefault();
  if (!_dragCatId || _dragCatId === targetId) return;

  // Reorder categories array
  const fromIdx = categories.findIndex(c => c.id === _dragCatId);
  const toIdx   = categories.findIndex(c => c.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;

  const moved = categories.splice(fromIdx, 1)[0];
  categories.splice(toIdx, 0, moved);

  renderGestor();

  // Persist new order to Supabase
  try {
    await Promise.all(categories.map((cat, i) =>
      sb.from('categories').update({ sort_order: i + 1 }).eq('id', cat.id)
    ));
    sbToast('ok', 'Ordem das categorias salva!');
  } catch(err) {
    sbToast('err', 'Erro ao salvar ordem');
  }
}

// ─────────────────────────────────────────
// GESTOR — DRAG & DROP ITENS
// ─────────────────────────────────────────
let _dragItemId = null;

function itemDragStart(e, id) {
  _dragItemId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
  setTimeout(() => e.target.closest('.cat-item-row')?.classList.add('dragging'), 0);
}

function itemDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const row = e.target.closest('.cat-item-row');
  document.querySelectorAll('.cat-item-row.drag-over').forEach(r => r.classList.remove('drag-over'));
  if (row && parseInt(row.dataset.id) !== _dragItemId) {
    row.classList.add('drag-over');
  }
}

function itemDragEnd(e) {
  document.querySelectorAll('.cat-item-row').forEach(r => {
    r.classList.remove('dragging');
    r.classList.remove('drag-over');
  });
  _dragItemId = null;
}

async function itemDrop(e, targetId) {
  e.preventDefault();
  if (!_dragItemId || _dragItemId === targetId) return;

  const fromIdx = items.findIndex(i => i.id === _dragItemId);
  const toIdx   = items.findIndex(i => i.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;

  const moved = items.splice(fromIdx, 1)[0];
  items.splice(toIdx, 0, moved);

  renderGestor();

  // Persiste a nova ordem para os itens da mesma categoria
  const catKey = moved.catKey;
  const catItems = items.filter(i => i.catKey === catKey || i.cat === catKey);
  try {
    await Promise.all(catItems.map((item, i) =>
      sb.from('menu_items').update({ sort_order: i + 1 }).eq('id', item.id)
    ));
    sbToast('ok', 'Ordem dos itens salva!');
  } catch(err) {
    sbToast('err', 'Erro ao salvar ordem dos itens');
  }
}

// ─────────────────────────────────────────
// GESTOR DE CARDÁPIO
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// MODELOS PRONTOS DE CARDÁPIO
// ─────────────────────────────────────────
const MODELOS_CARDAPIO = {
  acaiteria: {
    label: 'Açaiteria',
    categorias: [
      {
        label: 'Tamanhos',
        name: 'tamanhos',
        type: 'Itens principais',
        itens: [
          { name: 'Açaí 300ml',   emoji: '🍇', price: 12.00, description: 'Açaí 300ml — base pura, monte do seu jeito' },
          { name: 'Açaí 400ml',   emoji: '🍇', price: 15.00, description: 'Açaí 400ml — tamanho ideal para um lanche' },
          { name: 'Açaí 500ml',   emoji: '🍇', price: 18.00, description: 'Açaí 500ml — generoso e bem servido' },
          { name: 'Açaí 700ml',   emoji: '🍇', price: 23.00, description: 'Açaí 700ml — o favorito da galera' },
          { name: 'Açaí 1 Litro', emoji: '🪣', price: 30.00, description: 'Açaí 1 litro — para compartilhar' },
          { name: 'Tigela P',     emoji: '🥣', price: 14.00, description: 'Tigela pequena de açaí' },
          { name: 'Tigela M',     emoji: '🥣', price: 20.00, description: 'Tigela média de açaí' },
          { name: 'Tigela G',     emoji: '🥣', price: 27.00, description: 'Tigela grande de açaí' },
        ]
      },
      {
        label: 'Complementos',
        name: 'complementos',
        type: 'checklist',
        itens: [
          { name: 'Granola',          emoji: '🌾', price: 0.00, description: 'Granola crocante' },
          { name: 'Leite em Pó',      emoji: '🥛', price: 0.00, description: 'Leite em pó' },
          { name: 'Paçoca',           emoji: '🥜', price: 0.00, description: 'Paçoca triturada' },
          { name: 'Amendoim',         emoji: '🥜', price: 0.00, description: 'Amendoim torrado' },
          { name: 'Aveia',            emoji: '🌾', price: 0.00, description: 'Aveia em flocos' },
          { name: 'Sucrilhos',        emoji: '🥣', price: 0.00, description: 'Sucrilhos crocantes' },
          { name: 'Coco Ralado',      emoji: '🥥', price: 0.00, description: 'Coco ralado' },
          { name: 'Confeito',         emoji: '🍬', price: 0.00, description: 'Confeito colorido' },
          { name: 'Granulado',        emoji: '🍫', price: 0.00, description: 'Granulado de chocolate' },
        ]
      },
      {
        label: 'Coberturas',
        name: 'coberturas',
        type: 'checklist',
        itens: [
          { name: 'Mel',              emoji: '🍯', price: 0.00, description: 'Mel puro' },
          { name: 'Leite Condensado', emoji: '🥛', price: 0.00, description: 'Leite condensado' },
          { name: 'Calda de Morango', emoji: '🍓', price: 0.00, description: 'Calda de morango' },
          { name: 'Calda de Chocolate', emoji: '🍫', price: 0.00, description: 'Calda de chocolate' },
          { name: 'Nutella',          emoji: '🫙', price: 3.00, description: 'Nutella — adicional' },
        ]
      },
      {
        label: 'Frutas',
        name: 'frutas',
        type: 'checklist',
        itens: [
          { name: 'Morango',  emoji: '🍓', price: 0.00, description: 'Morango fresco' },
          { name: 'Banana',   emoji: '🍌', price: 0.00, description: 'Banana fatiada' },
          { name: 'Kiwi',     emoji: '🥝', price: 0.00, description: 'Kiwi fatiado' },
          { name: 'Uva',      emoji: '🍇', price: 0.00, description: 'Uva sem semente' },
        ]
      },
      {
        label: 'Adicionais',
        name: 'adicionais_acai',
        type: 'checklist',
        itens: [
          { name: 'Chantilly',       emoji: '🍦', price: 2.00, description: 'Chantilly' },
          { name: 'Sorvete extra',   emoji: '🍨', price: 4.00, description: 'Bola de sorvete extra' },
          { name: 'Proteína em pó',  emoji: '💪', price: 5.00, description: 'Scoop de proteína' },
        ]
      },
    ]
  },
  restaurante: {
    label: 'Restaurante',
    categorias: [
      { label: 'Entradas', name: 'entradas', itens: [
        { name: 'Caldo de Feijão',   emoji: '🫕', price: 12.00, description: 'Caldo de feijão temperado' },
        { name: 'Isca de Frango',    emoji: '🍗', price: 22.00, description: 'Isca de frango empanada' },
        { name: 'Camarão ao Alho',   emoji: '🦐', price: 35.00, description: 'Camarão ao alho e óleo' },
      ]},
      { label: 'Pratos Principais', name: 'pratos_principais', itens: [
        { name: 'Frango Grelhado',   emoji: '🍗', price: 35.00, description: 'Frango grelhado com acompanhamentos' },
        { name: 'Picanha na Brasa',  emoji: '🥩', price: 65.00, description: 'Picanha na brasa 300g' },
        { name: 'Filé de Peixe',     emoji: '🐟', price: 42.00, description: 'Filé de peixe grelhado' },
        { name: 'Marmita P',         emoji: '🍱', price: 18.00, description: 'Marmita pequena completa' },
        { name: 'Marmita G',         emoji: '🍱', price: 25.00, description: 'Marmita grande completa' },
      ]},
      { label: 'Sobremesas', name: 'sobremesas', itens: [
        { name: 'Pudim',             emoji: '🍮', price: 10.00, description: 'Pudim de leite condensado' },
        { name: 'Mousse de Maracujá',emoji: '🍨', price: 10.00, description: 'Mousse de maracujá' },
        { name: 'Sorvete',           emoji: '🍦', price: 8.00, description: '2 bolas de sorvete' },
      ]},
      { label: 'Bebidas', name: 'bebidas', itens: [
        { name: 'Suco Natural',   emoji: '🥤', price: 8.00, description: 'Suco da fruta natural 400ml' },
        { name: 'Refrigerante',   emoji: '🥤', price: 6.00, description: 'Lata 350ml' },
        { name: 'Água',           emoji: '💧', price: 3.00, description: 'Água mineral 500ml' },
        { name: 'Cerveja',        emoji: '🍺', price: 9.00, description: 'Garrafa 600ml' },
      ]},
    ]
  },
  pizzaria: {
    label: 'Pizzaria',
    categorias: [
      { label: 'Pizzas Salgadas', name: 'pizzas_salgadas', itens: [
        { name: 'Margherita',         emoji: '🍕', price: 48.00, description: 'Molho de tomate, mussarela e manjericão' },
        { name: 'Calabresa',          emoji: '🍕', price: 52.00, description: 'Molho, mussarela e calabresa' },
        { name: 'Frango com Catupiry',emoji: '🍕', price: 58.00, description: 'Molho, mussarela, frango e catupiry' },
        { name: 'Portuguesa',         emoji: '🍕', price: 60.00, description: 'Molho, mussarela, presunto, ovo e pimentão' },
        { name: 'Quatro Queijos',     emoji: '🍕', price: 65.00, description: 'Molho, mussarela, provolone, parmesão e gorgonzola' },
      ]},
      { label: 'Pizzas Doces', name: 'pizzas_doces', itens: [
        { name: 'Chocolate com Morango', emoji: '🍕', price: 55.00, description: 'Chocolate ao leite e morangos frescos' },
        { name: 'Romeu e Julieta',    emoji: '🍕', price: 50.00, description: 'Mussarela e goiabada' },
        { name: 'Banana com Canela',  emoji: '🍕', price: 48.00, description: 'Banana, canela e leite condensado' },
      ]},
      { label: 'Bordas', name: 'bordas', itens: [
        { name: 'Borda Recheada Catupiry', emoji: '🧀', price: 8.00, description: 'Borda recheada com catupiry' },
        { name: 'Borda Recheada Cheddar',  emoji: '🧀', price: 8.00, description: 'Borda recheada com cheddar' },
        { name: 'Borda Simples',           emoji: '🍞', price: 0.00, description: 'Borda tradicional' },
      ]},
      { label: 'Bebidas', name: 'bebidas_pizza', itens: [
        { name: 'Refrigerante 2L',    emoji: '🥤', price: 12.00, description: 'Refrigerante 2 litros' },
        { name: 'Cerveja Long Neck',  emoji: '🍺', price: 10.00, description: 'Cerveja long neck 355ml' },
        { name: 'Suco de Uva',        emoji: '🍇', price: 12.00, description: 'Suco de uva integral' },
      ]},
    ]
  },
  hamburgueria: {
    label: 'Hamburgueria',
    categorias: [
      { label: 'Hambúrgueres', name: 'hamburgueres', itens: [
        { name: 'Classic Burger',    emoji: '🍔', price: 28.00, description: 'Pão, carne 150g, queijo, alface e tomate' },
        { name: 'Double Smash',      emoji: '🍔', price: 38.00, description: 'Pão brioche, 2 smash patties, queijo american' },
        { name: 'Chicken Crispy',    emoji: '🍗', price: 32.00, description: 'Pão, frango crocante, cheddar e bacon' },
        { name: 'Veggie Burger',     emoji: '🥗', price: 30.00, description: 'Pão, hambúrguer de grão-de-bico, rúcula' },
      ]},
      { label: 'Combos', name: 'combos', itens: [
        { name: 'Combo Clássico',    emoji: '🍔', price: 42.00, description: 'Hambúrguer + Batata M + Refrigerante' },
        { name: 'Combo Duplo',       emoji: '🍔', price: 55.00, description: 'Hambúrguer Duplo + Batata G + Refrigerante' },
      ]},
      { label: 'Acompanhamentos', name: 'acompanhamentos', itens: [
        { name: 'Batata Frita P',    emoji: '🍟', price: 12.00, description: 'Porção pequena de batata frita' },
        { name: 'Batata Frita G',    emoji: '🍟', price: 18.00, description: 'Porção grande de batata frita' },
        { name: 'Onion Rings',       emoji: '🧅', price: 16.00, description: 'Anéis de cebola empanados' },
        { name: 'Fritas com Cheddar',emoji: '🧀', price: 22.00, description: 'Batata frita com cheddar e bacon' },
      ]},
      { label: 'Bebidas', name: 'bebidas_burger', itens: [
        { name: 'Milkshake',         emoji: '🥛', price: 20.00, description: 'Milkshake 400ml — vários sabores' },
        { name: 'Refrigerante Lata', emoji: '🥤', price: 6.00, description: 'Lata 350ml' },
        { name: 'Água',              emoji: '💧', price: 4.00, description: 'Água mineral 500ml' },
      ]},
    ]
  },
  cafeteria: {
    label: 'Cafeteria',
    categorias: [
      { label: 'Cafés', name: 'cafes', itens: [
        { name: 'Espresso',      emoji: '☕', price: 6.00, description: 'Espresso tradicional' },
        { name: 'Cappuccino',    emoji: '☕', price: 10.00, description: 'Cappuccino 300ml' },
        { name: 'Latte',         emoji: '☕', price: 12.00, description: 'Café latte com leite vaporizado' },
        { name: 'Café Gelado',   emoji: '🧊', price: 14.00, description: 'Cold brew 400ml' },
      ]},
      { label: 'Sucos e Vitaminas', name: 'sucos', itens: [
        { name: 'Suco Verde',    emoji: '🥤', price: 12.00, description: 'Couve, maçã e gengibre' },
        { name: 'Vitamina',      emoji: '🥛', price: 14.00, description: 'Vitamina de banana com aveia' },
        { name: 'Água de Coco',  emoji: '🥥', price: 8.00, description: 'Água de coco natural' },
      ]},
      { label: 'Salgados', name: 'salgados', itens: [
        { name: 'Croissant',     emoji: '🥐', price: 12.00, description: 'Croissant de presunto e queijo' },
        { name: 'Coxinha',       emoji: '🍗', price: 7.00, description: 'Coxinha de frango' },
        { name: 'Wrap',          emoji: '🌯', price: 18.00, description: 'Wrap de frango grelhado' },
      ]},
      { label: 'Doces', name: 'doces_cafe', itens: [
        { name: 'Brownie',       emoji: '🍫', price: 10.00, description: 'Brownie de chocolate' },
        { name: 'Muffin',        emoji: '🧁', price: 9.00, description: 'Muffin de blueberry' },
        { name: 'Cheesecake',    emoji: '🍰', price: 15.00, description: 'Fatia de cheesecake com calda de frutas' },
      ]},
    ]
  },
  padaria: {
    label: 'Padaria',
    categorias: [
      { label: 'Pães', name: 'paes', itens: [
        { name: 'Pão Francês',   emoji: '🥖', price: 0.70, description: 'Pão francês fresquinho — unidade' },
        { name: 'Pão de Queijo', emoji: '🧀', price: 3.50, description: 'Pão de queijo mineiro — unidade' },
        { name: 'Pão de Forma',  emoji: '🍞', price: 9.00, description: 'Pão de forma fatiado — pacote' },
        { name: 'Baguete',       emoji: '🥖', price: 8.00, description: 'Baguete tradicional' },
      ]},
      { label: 'Salgados', name: 'salgados_padaria', itens: [
        { name: 'Esfiha',        emoji: '🥙', price: 5.00, description: 'Esfiha de carne' },
        { name: 'Enroladinho',   emoji: '🌯', price: 4.50, description: 'Enroladinho de presunto e queijo' },
        { name: 'Pastel',        emoji: '🥟', price: 6.00, description: 'Pastel de carne' },
        { name: 'Pizza Pão',     emoji: '🍕', price: 7.00, description: 'Pizza pão individual' },
      ]},
      { label: 'Doces', name: 'doces_padaria', itens: [
        { name: 'Sonho',         emoji: '🍩', price: 5.00, description: 'Sonho com recheio de creme' },
        { name: 'Brigadeirão',   emoji: '🍫', price: 4.50, description: 'Fatia de brigadeirão' },
        { name: 'Bolo de Cenoura', emoji: '🍰', price: 6.00, description: 'Fatia de bolo de cenoura com cobertura' },
      ]},
      { label: 'Bolos', name: 'bolos', itens: [
        { name: 'Bolo Festa 1kg',  emoji: '🎂', price: 65.00, description: 'Bolo de festa confeitado 1kg' },
        { name: 'Bolo de Pote',    emoji: '🍮', price: 15.00, description: 'Bolo de pote individual' },
      ]},
      { label: 'Bebidas', name: 'bebidas_padaria', itens: [
        { name: 'Café Coado',    emoji: '☕', price: 4.00, description: 'Café coado — copo' },
        { name: 'Achocolatado',  emoji: '🥛', price: 6.00, description: 'Achocolatado quente ou frio 300ml' },
        { name: 'Suco de Laranja', emoji: '🍊', price: 7.00, description: 'Suco de laranja natural' },
      ]},
    ]
  },
};

let _modeloSelecionado = null;

function selecionarModelo(tipo) {
  console.log('[MODELO] selecionarModelo:', tipo);
  _modeloSelecionado = tipo;
  const modelo = MODELOS_CARDAPIO[tipo];
  if (!modelo) return;

  // Atualiza visual dos cards
  document.querySelectorAll('.modelo-card').forEach(c => {
    c.style.borderColor = 'var(--border)';
    c.style.background  = 'var(--surface2)';
  });
  const card = document.getElementById('modelo-' + tipo);
  if (card) {
    card.style.borderColor = 'var(--accent)';
    card.style.background  = 'rgba(59,130,246,.08)';
  }

  // Mostra aviso e preview
  document.getElementById('modelos-aviso').style.display = 'block';
  document.getElementById('modelo-preview').style.display = 'block';
  document.getElementById('btn-aplicar-modelo').style.display = 'flex';

  const prev = document.getElementById('modelo-preview-content');
  prev.innerHTML = modelo.categorias.map(cat => `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
      <div style="font-weight:700;font-size:12.5px;margin-bottom:8px;display:flex;align-items:center;gap:6px">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M5 8h6M5 5h3M5 11h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        ${cat.label}
        <span style="font-size:10px;color:var(--muted);font-weight:400">(${cat.itens.length} itens)</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">
        ${cat.itens.map(it => `
          <span style="font-size:11px;padding:3px 8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--muted2)">
            ${it.emoji} ${it.name} ${it.price > 0 ? '· R$' + it.price.toFixed(2).replace('.',',') : ''}
          </span>`).join('')}
      </div>
    </div>`).join('');
}

// ── Limpa todo o cardápio do tenant ──────────────────
async function limparCardapioAtual() {
  console.log('[LIMPAR] iniciando | items:', items.length, '| categories:', categories.length);
  if (items.length > 0) {
    console.log('[LIMPAR] deletando menu_items...');
    const { error: errItems } = await sb.from('menu_items').delete().neq('id', 0);
    if (errItems) { console.error('[LIMPAR] ❌ itens:', errItems); throw new Error('Erro ao limpar itens: ' + (errItems.message || errItems)); }
    console.log('[LIMPAR] ✅ itens deletados');
  }
  if (categories.length > 0) {
    console.log('[LIMPAR] deletando categories...');
    const { error: errCats } = await sb.from('categories').delete().neq('id', 0);
    if (errCats) { console.error('[LIMPAR] ❌ cats:', errCats); throw new Error('Erro ao limpar categorias: ' + (errCats.message || errCats)); }
    console.log('[LIMPAR] ✅ categorias deletadas');
  }
  items.length = 0;
  categories.length = 0;
  console.log('[LIMPAR] concluído');
}

// ── Excluir tudo com confirmação dupla ───────────────
async function excluirTodoCardapio() {
  if (!categories.length && !items.length) {
    sbToast('err', 'O cardápio já está vazio.');
    return;
  }

  const primeira = confirm(`Tem certeza que deseja EXCLUIR TODO O CARDÁPIO?\n\n${categories.length} categoria(s) · ${items.length} item(s) serão deletados permanentemente.`);
  if (!primeira) return;

  const segunda = confirm('⚠️ Esta ação não pode ser desfeita.\n\nConfirme novamente para excluir tudo.');
  if (!segunda) return;

  closeModal('modal-modelos');
  sbLoading(true);
  try {
    await limparCardapioAtual();
    renderGestor();
    renderTable();
    populateCatSelects();
    sbToast('ok', 'Cardápio excluído com sucesso.');
  } catch(e) {
    sbToast('err', 'Erro ao excluir: ' + e.message);
    console.error('[excluirTodoCardapio]', e);
  } finally {
    sbLoading(false);
  }
}

async function aplicarModelo() {
  console.log('[MODELO] aplicarModelo chamado | selecionado:', _modeloSelecionado);
  if (!_modeloSelecionado) { sbToast('err', 'Selecione um modelo primeiro'); return; }
  const modelo = MODELOS_CARDAPIO[_modeloSelecionado];
  if (!modelo) { sbToast('err', 'Modelo inválido'); return; }

  const substituir = document.getElementById('toggle-limpar-cardapio')?.classList.contains('on');
  console.log('[MODELO] substituir cardápio atual:', substituir, '| cats existentes:', categories.length, '| itens existentes:', items.length);

  if (substituir && (categories.length > 0 || items.length > 0)) {
    const ok = confirm(`Tem certeza? Isso vai APAGAR todo o cardápio atual (${categories.length} categoria(s) · ${items.length} item(s)) e substituir pelo modelo "${modelo.label}".`);
    if (!ok) return;
  }

  const btn = document.getElementById('btn-aplicar-modelo');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spin"></div> Aplicando...'; }
  sbLoading(true);

  let catsCriadas = 0, itensCriados = 0, erros = 0;

  try {
    if (substituir) {
      console.log('[MODELO] limpando cardápio atual...');
      await limparCardapioAtual();
      console.log('[MODELO] cardápio limpo OK');
    }

    let catSortOrder = categories.length;
    console.log('[MODELO] iniciando inserção | categorias do modelo:', modelo.categorias.length);

    for (const catDef of modelo.categorias) {
      console.log('[MODELO] inserindo categoria:', catDef.name, catDef.label);

      const { data: catData, error: catErr } = await sb.from('categories').insert({
        name:       catDef.name,
        label:      catDef.label,
        type:       catDef.type || 'Itens principais',
        promo:      false,
        sort_order: ++catSortOrder
      }).select().single();

      if (catErr || !catData) {
        erros++;
        console.error('[MODELO] ❌ Erro ao criar categoria:', catDef.name, '| erro:', catErr, '| data:', catData);
        sbToast('err', `Erro ao criar categoria "${catDef.label}": ${catErr?.message || 'resposta inválida'}`);
        continue;
      }

      console.log('[MODELO] ✅ categoria criada:', catData.id, catData.name);
      catsCriadas++;
      categories.push({
        id:    catData.id,
        name:  catData.name,
        label: catData.label || catDef.label,
        type:  catData.type  || catDef.type || 'Itens principais',
        promo: false,
        open:  false
      });

      const itensDef = catDef.itens || [];
      console.log('[MODELO] inserindo', itensDef.length, 'itens na categoria', catData.name);

      for (const itemDef of itensDef) {
        console.log('[MODELO]   → item:', itemDef.name, '| emoji:', itemDef.emoji, '| preço:', itemDef.price);
        const { data: itemData, error: itemErr } = await sb.from('menu_items').insert({
          emoji:        itemDef.emoji       || '🍽️',
          name:         itemDef.name,
          description:  itemDef.description || '',
          price:        parseFloat(itemDef.price) || 0,
          price_old:    null,
          cat:          catData.label,
          cat_key:      catData.name,
          item_type:    'normal',
          allow_half:   false,
          max_flavors:  1,
          promo:        false,
          destaque:     false,
          status:       'active',
          days:         [1,1,1,1,1,1,1],
          ingredients:  [],
          custom_groups: []
        }).select().single();

        if (itemErr || !itemData) {
          erros++;
          console.error('[MODELO]   ❌ Erro ao criar item:', itemDef.name, '| erro:', itemErr, '| data:', itemData);
          continue;
        }

        console.log('[MODELO]   ✅ item criado id:', itemData.id, itemData.name);
        itensCriados++;
        items.push(mapItem(itemData));
      }
    }

    console.log('[MODELO] FIM | cats:', catsCriadas, '| itens:', itensCriados, '| erros:', erros);

    closeModal('modal-modelos');
    document.getElementById('toggle-limpar-cardapio')?.classList.remove('on');
    document.getElementById('modelos-aviso').style.display    = 'none';
    document.getElementById('modelo-preview').style.display   = 'none';
    document.getElementById('btn-aplicar-modelo').style.display = 'none';
    document.querySelectorAll('.modelo-card').forEach(c => {
      c.style.borderColor = 'var(--border)';
      c.style.background  = 'var(--surface2)';
    });

    renderGestor();
    renderTable();
    populateCatSelects();

    if (erros > 0) {
      sbToast('err', `Modelo aplicado com ${erros} erro(s). ${catsCriadas} cat · ${itensCriados} itens criados.`);
    } else {
      sbToast('ok', `Modelo "${modelo.label}" aplicado! ${catsCriadas} categorias · ${itensCriados} itens criados.`);
    }

  } catch(e) {
    console.error('[MODELO] ❌ EXCEÇÃO:', e);
    sbToast('err', 'Erro ao aplicar modelo: ' + e.message);
    renderGestor();
    renderTable();
  } finally {
    sbLoading(false);
    _modeloSelecionado = null;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 2h8l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.4"/><path d="M9 2v4h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg> Aplicar modelo`;
    }
  }
}

// ── Exportar cardápio atual ───────────────────────────
function exportarCardapio() {
  try {
    // Monta estrutura exportável
    const exportData = {
      _versao:    1,
      _exportado: new Date().toISOString(),
      _nome:      document.getElementById('sidebar-nome')?.textContent || 'cardapio',
      categorias: categories.map(cat => ({
        name:  cat.name,
        label: cat.label,
        type:  cat.type  || 'Itens principais',
        promo: cat.promo || false,
        itens: items
          .filter(i => i.catKey === cat.name)
          .map(i => ({
            name:        i.name,
            emoji:       i.emoji       || '🍽️',
            description: i.description || '',
            price:       i.price       || 0,
            price_old:   i.priceOld    || null,
            status:      i.status      || 'active',
            item_type:   i.itemType    || 'normal',
            allow_half:  i.allowHalf   || false,
            max_flavors: i.maxFlavors  || 1,
            ingredients: i.ingredients || [],
            days:        i.days        || [1,1,1,1,1,1,1],
          }))
      }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const data = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    a.href     = url;
    a.download = `cardapio-${exportData._nome.toLowerCase().replace(/\s+/g,'-')}-${data}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    sbToast('ok', `Cardápio exportado com ${categories.length} categoria(s)!`);
  } catch(e) {
    sbToast('err', 'Erro ao exportar: ' + e.message);
    console.error(e);
  }
}

// ── Importar cardápio de arquivo .json ───────────────
async function importarCardapio(inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;
  inputEl.value = ''; // reset para permitir re-importar mesmo arquivo

  let parsed;
  try {
    const text = await file.text();
    parsed = JSON.parse(text);
  } catch(e) {
    sbToast('err', 'Arquivo inválido — não é um JSON válido');
    return;
  }

  if (!parsed?.categorias || !Array.isArray(parsed.categorias)) {
    sbToast('err', 'Arquivo não reconhecido — falta a chave "categorias"');
    return;
  }

  const total = parsed.categorias.reduce((s, c) => s + (c.itens?.length || 0), 0);

  const substituir = categories.length > 0 && confirm(
    `Deseja SUBSTITUIR o cardápio atual?\n\nAtual: ${categories.length} categoria(s) · ${items.length} item(s)\nImportando: ${parsed.categorias.length} categoria(s) · ${total} item(s)\n\nOK = substituir | Cancelar = adicionar ao existente.`
  );

  closeModal('modal-modelos');
  sbLoading(true);

  let catsCriadas = 0, itensCriados = 0, erros = 0;

  try {
    if (substituir) {
      await limparCardapioAtual();
    }

    let catSortOrder = categories.length;

    for (const catDef of parsed.categorias) {
      if (!catDef.name || !catDef.label) { erros++; continue; }

      const { data: catData, error: catErr } = await sb.from('categories').insert({
        name:       catDef.name,
        label:      catDef.label,
        type:       catDef.type  || 'Itens principais',
        promo:      catDef.promo || false,
        sort_order: ++catSortOrder
      }).select().single();

      if (catErr || !catData) { console.error('[importar] cat:', catErr); erros++; continue; }
      catsCriadas++;
      categories.push({
        id: catData.id, name: catData.name, label: catData.label,
        type: catData.type, promo: catData.promo || false, open: false
      });

      for (const itemDef of (catDef.itens || [])) {
        if (!itemDef.name) { erros++; continue; }

        const { data: itemData, error: itemErr } = await sb.from('menu_items').insert({
          emoji:         itemDef.emoji         || '🍽️',
          name:          itemDef.name,
          description:   itemDef.description   || '',
          price:         parseFloat(itemDef.price) || 0,
          price_old:     itemDef.price_old      || null,
          cat:           catData.label,
          cat_key:       catData.name,
          item_type:     itemDef.item_type      || 'normal',
          allow_half:    itemDef.allow_half     || false,
          max_flavors:   itemDef.max_flavors    || 1,
          promo:         false,
          destaque:      false,
          status:        itemDef.status         || 'active',
          days:          itemDef.days           || [1,1,1,1,1,1,1],
          ingredients:   itemDef.ingredients    || [],
          custom_groups: itemDef.custom_groups  || []
        }).select().single();

        if (itemErr || !itemData) { console.error('[importar] item:', itemErr); erros++; continue; }
        itensCriados++;
        items.push(mapItem(itemData));
      }
    }

    renderGestor();
    renderTable();
    populateCatSelects();
    const msg = `✅ Importado: ${catsCriadas} categoria(s) · ${itensCriados} item(s)` + (erros ? ` · ⚠️ ${erros} erro(s)` : '');
    sbToast(erros ? 'err' : 'ok', msg);

  } catch(e) {
    sbToast('err', 'Erro ao importar: ' + e.message);
    console.error('[importarCardapio]', e);
    renderGestor();
  } finally {
    sbLoading(false);
  }
}

// ─────────────────────────────────────────
function renderGestor(){
  try {
    const cl=document.getElementById('cat-list');
    if(!cl) return;
    if(!categories.length){
      cl.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--muted);font-size:13px">Nenhuma categoria ainda.<br>Clique em <strong style="color:var(--accent)">Nova categoria</strong> para começar.</div>';
      return;
    }
    cl.innerHTML=categories.map((cat,idx)=>{
      const catItems=items.filter(i=>i.catKey===cat.name||i.cat===cat.name);
      return `
      ${cat.promo?'<div class="cat-promo-banner">promo</div>':''}
      <div class="cat-row" draggable="true" data-cat-id="${cat.id}"
           ondragstart="catDragStart(event,${cat.id})"
           ondragover="catDragOver(event)"
           ondrop="catDrop(event,${cat.id})"
           ondragend="catDragEnd(event)">
        <div class="cat-head" onclick="toggleCat(${cat.id})">
          <span class="cat-drag" onmousedown="event.stopPropagation()" title="Arrastar para reordenar">⠿</span>
          <div>
            <div class="cat-name">${cat.label}</div>
            <span class="cat-badge">${catItems.length} ite${catItems.length===1?'m':'ns'}</span>
          </div>
          <div class="cat-actions">
            <div class="sw"><select onclick="event.stopPropagation()" style="font-size:11.5px;padding:4px 22px 4px 9px" onchange="handleCatAction(${cat.id},this.value)"><option value="">Ações ▾</option><option value="edit">Editar</option><option value="duplicate">Duplicar</option><option value="pause">Pausar</option><option value="delete">Excluir</option></select></div>
            <div class="cat-toggle${cat.open?' open':''}"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          </div>
        </div>
        ${cat.open?`<div class="cat-items">
          ${catItems.map(item=>`
            <div class="cat-item-row" data-id="${item.id}" draggable="true" ondragstart="itemDragStart(event,${item.id})" ondragover="itemDragOver(event)" ondrop="itemDrop(event,${item.id})" ondragend="itemDragEnd(event)" onclick="openEditItem(+this.dataset.id)">
              <span class="cat-drag" style="cursor:grab;padding:0 6px 0 2px;opacity:.35;flex-shrink:0;font-size:16px;align-self:center" onmousedown="event.stopPropagation()" title="Arrastar para reordenar">⠿</span>
              <div class="cat-item-thumb">${item.imageUrl
                ? `<img src="${item.imageUrl}" style="width:36px;height:36px;object-fit:cover;border-radius:6px;display:block">`
                : `<svg viewBox="0 0 24 24" fill="none" width="18" height="18" style="opacity:.35"><path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" stroke="currentColor" stroke-width="1.5"/><path d="M3 16l5-5 3 3 3-4 4 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" opacity=".5"/></svg>`
              }</div>
              <div style="flex:1;min-width:0">
                <div class="cat-item-name">${item.name}${item.promo?' <span class="ptag">promo</span>':''}${item.itemType==='pizza'?' <span style="font-size:9px;background:rgba(245,158,11,.15);color:var(--accent3);border-radius:4px;padding:1px 4px;font-weight:700;margin-left:2px">🍕</span>':''}</div>
                <div class="cat-item-price">R$ ${item.price.toFixed(2).replace('.',',')} · ${item.status==='active'?'<span style="color:var(--success)">Disponível</span>':item.status==='esgotado'?'<span style="color:var(--danger)">Esgotado</span>':'<span style="color:var(--accent3)">Pausado</span>'}</div>
              </div>
              <div style="display:flex;gap:4px;flex-shrink:0">
                <button class="btn bg" style="font-size:10.5px;padding:3px 8px" data-id="${item.id}" onclick="event.stopPropagation();duplicateItem(+this.dataset.id)" title="Duplicar item">⎘</button>
                <button class="btn bg" style="font-size:10.5px;padding:3px 8px" data-id="${item.id}" onclick="event.stopPropagation();openEditItem(+this.dataset.id)">Editar</button>
              </div>
            </div>
          `).join('')}
          <div class="cat-add" data-cat="${cat.name.replace(/"/g,'"')}" onclick="openAddItemModal(this.dataset.cat)">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
            Adicionar Item
          </div>
        </div>`:''}
      </div>`;
    }).join('');
  } catch(e) { console.error('renderGestor error:', e); }
}

function toggleCat(id){
  const cat=categories.find(c=>c.id===id);
  if(cat) cat.open=!cat.open;
  renderGestor();
}

function handleCatAction(id, action) {
  if (!action) return;
  if (action === 'edit') {
    const cat = categories.find(c => c.id === id);
    if (!cat) return;
    document.getElementById('edit-cat-id').value   = id;
    document.getElementById('edit-cat-name').value = cat.label;
    openModal('modal-edit-cat');
  } else if (action === 'duplicate') {
    duplicateCategory(id);
  } else if (action === 'delete') {
    deleteCatById(id);
  } else if (action === 'pause') {
    sbToast('ok', 'Categoria pausada!');
  }
}

// ── Duplicar categoria (cria cópia com todos os itens) ────
async function duplicateCategory(id) {
  const cat = categories.find(c => c.id === id);
  if (!cat) return;
  const novoLabel = cat.label + ' (cópia)';
  const novoName  = cat.name + '_copia_' + Date.now().toString().slice(-4);
  sbLoading(true);
  try {
    // 1. Cria nova categoria
    const { data: newCat, error: catErr } = await sb.from('categories').insert({
      name:       novoName,
      label:      novoLabel,
      type:       cat.type  || 'Itens principais',
      promo:      false,
      sort_order: categories.length + 1
    }).select().single();
    if (catErr || !newCat) throw new Error(catErr?.message || 'Erro ao criar categoria');

    categories.push({ id: newCat.id, name: newCat.name, label: newCat.label, type: newCat.type, promo: false, open: false });

    // 2. Duplica todos os itens desta categoria
    const catItems = items.filter(i => i.catKey === cat.name || i.cat === cat.name);
    let itensCriados = 0;
    for (const it of catItems) {
      const { data: newItem, error: itemErr } = await sb.from('menu_items').insert({
        emoji:        it.emoji        || '🍽️',
        name:         it.name,
        description:  it.desc         || '',
        price:        it.price        || 0,
        price_old:    it.priceOld     || null,
        cat:          newCat.label,
        cat_key:      newCat.name,
        item_type:    it.itemType     || 'normal',
        allow_half:   it.allowHalf    || false,
        max_flavors:  it.maxFlavors   || 1,
        promo:        it.promo        || false,
        destaque:     it.destaque     || false,
        status:       it.status       || 'active',
        days:         it.days         || [1,1,1,1,1,1,1],
        ingredients:  it.ingredients  || [],
        custom_groups: it.customGroups || [],
        image_url:    it.imageUrl     || null
      }).select().single();
      if (!itemErr && newItem) { items.push(mapItem(newItem)); itensCriados++; }
    }

    renderGestor(); renderTable(); populateCatSelects();
    sbToast('ok', `"${novoLabel}" criada com ${itensCriados} item(s) duplicado(s)!`);
  } catch(e) {
    sbToast('err', 'Erro ao duplicar categoria: ' + e.message);
  } finally {
    sbLoading(false);
  }
}

// ── Duplicar item ─────────────────────────────────────────
async function duplicateItem(id) {
  const it = items.find(i => i.id === id);
  if (!it) return;
  sbLoading(true);
  try {
    const { data: newItem, error } = await sb.from('menu_items').insert({
      emoji:        it.emoji        || '🍽️',
      name:         it.name + ' (cópia)',
      description:  it.desc         || '',
      price:        it.price        || 0,
      price_old:    it.priceOld     || null,
      cat:          it.cat,
      cat_key:      it.catKey,
      item_type:    it.itemType     || 'normal',
      allow_half:   it.allowHalf    || false,
      max_flavors:  it.maxFlavors   || 1,
      promo:        false,
      destaque:     false,
      status:       'active',
      days:         it.days         || [1,1,1,1,1,1,1],
      ingredients:  it.ingredients  || [],
      custom_groups: it.customGroups || [],
      image_url:    it.imageUrl     || null
    }).select().single();
    if (error || !newItem) throw new Error(error?.message || 'Resposta inválida');
    items.push(mapItem(newItem));
    renderGestor(); renderTable();
    sbToast('ok', `"${it.name}" duplicado!`);
  } catch(e) {
    sbToast('err', 'Erro ao duplicar item: ' + e.message);
  } finally {
    sbLoading(false);
  }
}

async function saveEditCategory() {
  const id   = parseInt(document.getElementById('edit-cat-id').value);
  const name = document.getElementById('edit-cat-name').value.trim();
  const type = document.getElementById('edit-cat-type').value;
  if (!name) { sbToast('err','Informe o nome'); return; }
  sbLoading(true);
  // Só atualiza 'label' e 'type' — nunca muda 'name' (chave interna usada pelo catKey dos itens)
  const { error } = await sb.from('categories').update({
    label: name, type
  }).eq('id', id);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao salvar'); return; }
  const cat = categories.find(c => c.id === id);
  if (cat) { cat.label = name; cat.type = type; }
  closeModal('modal-edit-cat');
  renderGestor();
  populateCatSelects();
  sbToast('ok', 'Categoria atualizada!');
}

async function deleteCatById(id) {
  const catId = id || parseInt(document.getElementById('edit-cat-id').value);
  if (!await showConfirmDialog('Excluir categoria?', 'Os itens desta categoria não serão apagados.')) return;
  sbLoading(true);
  const { error } = await sb.from('categories').delete().eq('id', catId);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao excluir'); return; }
  categories = categories.filter(c => c.id !== catId);
  closeModal('modal-edit-cat');
  renderGestor();
  populateCatSelects();
  sbToast('ok', 'Categoria excluída!');
}

async function addCategory() {
  const nameEl = document.getElementById('cat-name-input');
  const typeEl = document.getElementById('cat-type-input');
  const name   = nameEl ? nameEl.value.trim() : '';
  const type   = typeEl ? typeEl.value : 'Itens principais';

  console.log('[ADD-CAT] chamado | nome:', name, '| tipo:', type);

  if (!name) { sbToast('err', 'Informe o nome da categoria'); return; }

  const duplicada = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (duplicada) { sbToast('err', `Já existe uma categoria chamada "${name}"`); return; }

  const payload = {
    name:       name.toLowerCase().replace(/\s+/g, '_'),
    label:      name,
    type:       type || 'Itens principais',
    promo:      false,
    sort_order: categories.length + 1
  };
  console.log('[ADD-CAT] payload:', payload);

  sbLoading(true);
  const { data, error } = await sb.from('categories').insert(payload).select().single();
  sbLoading(false);

  console.log('[ADD-CAT] resposta | data:', data, '| error:', error);

  if (error || !data) {
    sbToast('err', 'Erro ao criar categoria: ' + (error?.message || 'resposta inválida'));
    console.error('[ADD-CAT] ❌', error);
    return;
  }

  console.log('[ADD-CAT] ✅ categoria criada id:', data.id);
  categories.push({
    id:    data.id,
    name:  data.name,
    label: data.label || name,
    type:  data.type  || type,
    promo: false,
    open:  false
  });

  closeModal('modal-add-cat');
  if (nameEl) nameEl.value = '';
  renderGestor();
  populateCatSelects();
  sbToast('ok', `Categoria "${name}" criada!`);
}

function handleGestorAction(val){
  document.getElementById('gestor-actions').value='';
  if(val==='pdv') nav('pdv');
  else if(val==='edicao') nav('edicao');
  else if(val==='imagens') nav('imagens');
}

