// ══════════════════════════════════════════════════════════════
//  TEMAS DO CARDÁPIO PÚBLICO — catálogo único
//  Usado pelo cardápio (index.html / totem.html) e pela tela de escolha
//  de tema no gestor. Cada tema define:
//   - cores (fundo, superfícies, texto, bordas)
//   - cor de destaque sugerida + 3 sugestões de cor
//   - fonte dos títulos: 'sans' (DM Sans), 'serif' (Fraunces) ou
//     'grotesk' (Bricolage Grotesque)
//   - raio: quanto os cantos de fotos, cartões e botões são arredondados
//  Temas antigos que eram repetidos viraram "apelidos" de um tema atual,
//  então nenhuma loja fica sem tema.
// ══════════════════════════════════════════════════════════════
(function () {
  const T = (key, grupo, nome, desc, segs, accent, swatches, fonte, raio, c) => ({
    key, grupo, nome, desc, segs, accent, swatches, fonte, raio,
    escuro: !!c.escuro,
    vars: {
      '--bg': c.bg, '--s1': c.s1, '--s2': c.s2, '--s3': c.s3,
      '--border': c.border, '--border2': c.border2,
      '--text': c.text, '--muted': c.muted, '--muted2': c.muted2
    }
  });

  const lista = [
    // ── Claros ──────────────────────────────────────────────
    T('classico', 'claros', 'Clássico', 'Branco e cinza claro. Combina com qualquer loja.',
      ['Qualquer loja'], '#f97316', ['#f97316', '#ea1d2c', '#2563eb'], 'sans', 10,
      { bg: '#f7f7f8', s1: '#ffffff', s2: '#f0f1f3', s3: '#e3e5e9', border: 'rgba(17,24,39,.08)', border2: 'rgba(17,24,39,.14)', text: '#111827', muted: '#6b7280', muted2: '#9ca3af' }),
    T('minimalista', 'claros', 'Minimal', 'Todo branco, cantos retos e preto como destaque.',
      ['Premium', 'Lojas de marca'], '#111111', ['#111111', '#b91c1c', '#1d4ed8'], 'sans', 3,
      { bg: '#ffffff', s1: '#ffffff', s2: '#f4f4f4', s3: '#e6e6e6', border: 'rgba(0,0,0,.08)', border2: 'rgba(0,0,0,.16)', text: '#0a0a0a', muted: '#6b6b6b', muted2: '#a3a3a3' }),
    T('padaria_gold', 'claros', 'Padaria e Café', 'Creme amanteigado com títulos em serifa. Aconchegante.',
      ['Padaria', 'Cafeteria', 'Confeitaria'], '#b7791f', ['#b7791f', '#7c4a1e', '#2f6b4f'], 'serif', 14,
      { bg: '#fbf5e9', s1: '#fffcf5', s2: '#f4e9d4', s3: '#e9d7b4', border: 'rgba(120,74,30,.12)', border2: 'rgba(120,74,30,.22)', text: '#33230f', muted: '#7d6243', muted2: '#a88c69' }),
    T('verde', 'claros', 'Natural', 'Verde-sálvia suave. Leve e saudável.',
      ['Saudável', 'Saladas', 'Vegano', 'Marmitas fit'], '#2f8a57', ['#2f8a57', '#0f766e', '#c2410c'], 'sans', 14,
      { bg: '#f2f6ef', s1: '#ffffff', s2: '#e6eee1', s3: '#d2e0ca', border: 'rgba(30,70,40,.10)', border2: 'rgba(30,70,40,.18)', text: '#14261a', muted: '#55705c', muted2: '#86a08b' }),
    T('mercado_azul', 'claros', 'Mercado', 'Azul confiável, cantos discretos. Organizado.',
      ['Mercado', 'Conveniência', 'Farmácia', 'Bebidas'], '#1d5fd1', ['#1d5fd1', '#0891b2', '#16a34a'], 'sans', 8,
      { bg: '#f2f6fb', s1: '#ffffff', s2: '#e5edf7', s3: '#cfdcee', border: 'rgba(16,40,80,.09)', border2: 'rgba(16,40,80,.16)', text: '#0f2540', muted: '#4f6681', muted2: '#8197b0' }),
    T('zen', 'claros', 'Zen', 'Papel de arroz e vermelho. Limpo e oriental.',
      ['Japonês', 'Sushi', 'Poke', 'Chinês'], '#c1272d', ['#c1272d', '#1f1f1f', '#3f6e5a'], 'sans', 4,
      { bg: '#f5f2ec', s1: '#fbf9f5', s2: '#ebe6dc', s3: '#dcd4c6', border: 'rgba(40,30,20,.10)', border2: 'rgba(40,30,20,.18)', text: '#1d1b18', muted: '#6d655a', muted2: '#a0978a' }),
    T('areia', 'claros', 'Areia', 'Bege areia com verde-petróleo e serifa. Sofisticado.',
      ['Restaurante', 'Árabe', 'Bistrô'], '#2f5d50', ['#2f5d50', '#9a3412', '#1e3a5f'], 'serif', 8,
      { bg: '#f3ece1', s1: '#faf6ef', s2: '#e9e0d1', s3: '#dacdb8', border: 'rgba(60,45,25,.11)', border2: 'rgba(60,45,25,.20)', text: '#2b231a', muted: '#73654f', muted2: '#a3957e' }),

    // ── Coloridos ───────────────────────────────────────────
    T('burger_red', 'coloridos', 'Street Burger', 'Papel kraft, vermelho forte e títulos encorpados.',
      ['Hamburgueria', 'Lanches', 'Hot dog'], '#d62828', ['#d62828', '#f77f00', '#1d1d1d'], 'grotesk', 4,
      { bg: '#f2ebdf', s1: '#faf6ef', s2: '#e7ddcc', s3: '#d8c9b0', border: 'rgba(40,25,10,.12)', border2: 'rgba(40,25,10,.22)', text: '#1c1612', muted: '#6f5e4d', muted2: '#a08d78' }),
    T('tropical', 'coloridos', 'Tropical', 'Laranja ensolarado e cantos bem redondos.',
      ['Lanchonete', 'Pastelaria', 'Açougue'], '#ea580c', ['#ea580c', '#dc2626', '#ca8a04'], 'grotesk', 16,
      { bg: '#fff7ec', s1: '#fffbf5', s2: '#ffecd2', s3: '#fdd6a6', border: 'rgba(194,65,12,.13)', border2: 'rgba(194,65,12,.22)', text: '#3d1606', muted: '#8a4513', muted2: '#b8743c' }),
    T('pizzaria_italia', 'coloridos', 'Cantina', 'Creme, vermelho tomate e serifa. Clima de cantina.',
      ['Pizzaria', 'Massas', 'Italiano'], '#c62828', ['#c62828', '#2e7d32', '#8d5524'], 'serif', 10,
      { bg: '#fbf4e8', s1: '#fffaf2', s2: '#f3e6cf', s3: '#e6d0ab', border: 'rgba(110,40,20,.11)', border2: 'rgba(110,40,20,.20)', text: '#2c1b10', muted: '#7a5b40', muted2: '#a88a6c' }),
    T('praia', 'coloridos', 'Praia', 'Verde-água com coral. Fresco e alegre.',
      ['Sucos', 'Peixes', 'Quiosque', 'Poke'], '#f25c45', ['#f25c45', '#0e9f8e', '#f59e0b'], 'grotesk', 16,
      { bg: '#eef9f6', s1: '#ffffff', s2: '#dcf1ec', s3: '#bfe4db', border: 'rgba(10,80,70,.10)', border2: 'rgba(10,80,70,.18)', text: '#0b3b35', muted: '#4b7a72', muted2: '#7fa69f' }),
    T('acai_berry', 'coloridos', 'Açaí', 'Lilás com roxo intenso. Divertido e marcante.',
      ['Açaí', 'Sorvete', 'Milk shake'], '#7b2cbf', ['#7b2cbf', '#d6336c', '#2f9e44'], 'grotesk', 18,
      { bg: '#f7f2fc', s1: '#ffffff', s2: '#ede3f8', s3: '#dccbf1', border: 'rgba(80,30,130,.10)', border2: 'rgba(80,30,130,.18)', text: '#2a1340', muted: '#6c5486', muted2: '#9d87b5' }),
    T('rose', 'coloridos', 'Confeitaria', 'Rosa delicado com serifa. Doce e elegante.',
      ['Doceria', 'Bolos', 'Cafeteria'], '#d6336c', ['#d6336c', '#a0522d', '#7048e8'], 'serif', 18,
      { bg: '#fdf1f4', s1: '#ffffff', s2: '#f9e0e7', s3: '#f2c6d3', border: 'rgba(150,30,70,.10)', border2: 'rgba(150,30,70,.18)', text: '#45162a', muted: '#8c5468', muted2: '#b58798' }),
    T('sorveteria', 'coloridos', 'Sorveteria', 'Azul-céu com rosa chiclete. Leve e divertido.',
      ['Sorveteria', 'Picolé', 'Açaí'], '#ec4899', ['#ec4899', '#0284c7', '#f59e0b'], 'grotesk', 20,
      { bg: '#eef6fd', s1: '#ffffff', s2: '#deedfa', s3: '#c4def5', border: 'rgba(20,70,120,.10)', border2: 'rgba(20,70,120,.18)', text: '#12324a', muted: '#55718a', muted2: '#88a1b7' }),
    T('pop', 'coloridos', 'Pop', 'Amarelo-manteiga com preto. Chama atenção.',
      ['Lanches', 'Pastel', 'Batata recheada'], '#111111', ['#111111', '#e63946', '#2563eb'], 'grotesk', 12,
      { bg: '#fff3c4', s1: '#fffbe8', s2: '#ffe999', s3: '#ffd95a', border: 'rgba(60,45,0,.14)', border2: 'rgba(60,45,0,.24)', text: '#1b1500', muted: '#6b5a12', muted2: '#9a8642' }),

    // ── Escuros ─────────────────────────────────────────────
    T('dark', 'escuros', 'Grafite', 'Escuro neutro e moderno. Faz as fotos brilharem.',
      ['Qualquer loja', 'Delivery noturno'], '#f97316', ['#f97316', '#22c55e', '#3b82f6'], 'sans', 10,
      { escuro: true, bg: '#111317', s1: '#1a1d23', s2: '#22262e', s3: '#2c313b', border: 'rgba(255,255,255,.07)', border2: 'rgba(255,255,255,.13)', text: '#f3f4f6', muted: '#9ca3af', muted2: '#6b7280' }),
    T('noturno', 'escuros', 'Neon', 'Roxo profundo com destaque neon. Clima de balada.',
      ['Bar', 'Tabacaria', 'Lanches da madrugada'], '#a855f7', ['#a855f7', '#22d3ee', '#f472b6'], 'grotesk', 14,
      { escuro: true, bg: '#0d0a17', s1: '#161126', s2: '#1f1935', s3: '#2a2246', border: 'rgba(200,170,255,.09)', border2: 'rgba(200,170,255,.16)', text: '#f1ecff', muted: '#a89cc8', muted2: '#71678f' }),
    T('acougue', 'escuros', 'Brasa', 'Carvão com laranja-brasa. Feito para carnes.',
      ['Churrascaria', 'Açougue', 'Espetinho'], '#f0612e', ['#f0612e', '#dc2626', '#eab308'], 'grotesk', 8,
      { escuro: true, bg: '#14100e', s1: '#1e1916', s2: '#29221d', s3: '#352c25', border: 'rgba(255,170,120,.09)', border2: 'rgba(255,170,120,.16)', text: '#f7ede6', muted: '#bfa999', muted2: '#87756a' }),
    T('dourado', 'escuros', 'Ouro Noir', 'Preto com dourado e serifa. Alto padrão.',
      ['Restaurante', 'Steakhouse', 'Vinhos'], '#c9a25b', ['#c9a25b', '#e8d5a8', '#9b2c2c'], 'serif', 4,
      { escuro: true, bg: '#0e0d0b', s1: '#181613', s2: '#211e1a', s3: '#2c2823', border: 'rgba(214,180,120,.10)', border2: 'rgba(214,180,120,.18)', text: '#f2ebde', muted: '#ab9f8a', muted2: '#7a705f' }),
    T('oceano', 'escuros', 'Oceano', 'Azul-marinho com turquesa. Frutos do mar.',
      ['Frutos do mar', 'Peixaria', 'Japonês'], '#22b8cf', ['#22b8cf', '#38bdf8', '#f59e0b'], 'sans', 12,
      { escuro: true, bg: '#0a1626', s1: '#0f1f35', s2: '#162944', s3: '#1e3555', border: 'rgba(120,200,255,.09)', border2: 'rgba(120,200,255,.16)', text: '#e3eef9', muted: '#8aa6c1', muted2: '#5d7896' }),
    T('sushi_black', 'escuros', 'Sumi', 'Preto tinta com vermelho e cantos retos.',
      ['Japonês', 'Sushi', 'Temakeria'], '#e63946', ['#e63946', '#f4a261', '#2a9d8f'], 'sans', 2,
      { escuro: true, bg: '#0b0b0b', s1: '#141414', s2: '#1c1c1c', s3: '#262626', border: 'rgba(255,255,255,.07)', border2: 'rgba(255,255,255,.14)', text: '#f2efe9', muted: '#a39e95', muted2: '#6f6b65' }),
    T('floresta', 'escuros', 'Floresta', 'Verde-musgo escuro. Natural e profundo.',
      ['Vegano', 'Saudável', 'Cafés especiais'], '#4ade80', ['#4ade80', '#facc15', '#fb923c'], 'serif', 12,
      { escuro: true, bg: '#0d1712', s1: '#13211a', s2: '#1a2c23', s3: '#23382d', border: 'rgba(160,230,180,.08)', border2: 'rgba(160,230,180,.15)', text: '#e8f3ec', muted: '#9bb5a5', muted2: '#6a8474' }),
    T('cacau', 'escuros', 'Cacau', 'Chocolate com caramelo. Quente e aconchegante.',
      ['Chocolateria', 'Cafeteria', 'Doceria'], '#e0a458', ['#e0a458', '#f472b6', '#c2410c'], 'serif', 14,
      { escuro: true, bg: '#1a120d', s1: '#231912', s2: '#2e2118', s3: '#3a2b20', border: 'rgba(240,190,140,.09)', border2: 'rgba(240,190,140,.16)', text: '#f4e8dc', muted: '#bba48f', muted2: '#86715f' }),
    T('vinho', 'escuros', 'Vinho', 'Bordô escuro com rosa queimado. Romântico.',
      ['Massas', 'Bar de vinhos', 'Jantar'], '#e0577a', ['#e0577a', '#d4a373', '#f8f9fa'], 'serif', 8,
      { escuro: true, bg: '#1a0b10', s1: '#241018', s2: '#2f1620', s3: '#3c1d2a', border: 'rgba(255,170,190,.09)', border2: 'rgba(255,170,190,.16)', text: '#f8e9ee', muted: '#c39aa8', muted2: '#8a6573' }),
    T('retro', 'escuros', 'Retrô', 'Preto com amarelo e cantos retos. Estilo fliperama.',
      ['Lanches', 'Hot dog', 'Food truck'], '#ffd60a', ['#ffd60a', '#ff5d8f', '#00c2ff'], 'grotesk', 0,
      { escuro: true, bg: '#121212', s1: '#1b1b1b', s2: '#242424', s3: '#2f2f2f', border: 'rgba(255,255,255,.08)', border2: 'rgba(255,214,10,.22)', text: '#f5f5f5', muted: '#a8a8a8', muted2: '#737373' })
  ];

  // Temas que eram repetidos → tema atual equivalente
  const aliases = {
    moderno: 'classico',
    delivery_pro: 'classico',
    premium_clean: 'minimalista',
    fresh_verde: 'verde',
    noite_delivery: 'dark'
  };

  const grupos = [
    { key: 'claros',    titulo: 'Claros',    desc: 'Fundo claro, leitura fácil de dia.' },
    { key: 'coloridos', titulo: 'Coloridos', desc: 'Fundo com cor e mais personalidade.' },
    { key: 'escuros',   titulo: 'Escuros',   desc: 'Fundo escuro, fotos em destaque.' }
  ];

  const fontes = {
    sans:    "'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
    serif:   "'Fraunces', Georgia, 'Times New Roman', serif",
    grotesk: "'Bricolage Grotesque', 'DM Sans', system-ui, sans-serif"
  };

  function resolver(key) {
    const k = aliases[key] || key;
    return lista.find(t => t.key === k) || lista[0];
  }

  window.TEMAS_CARDAPIO = { lista, aliases, grupos, fontes, resolver };
})();
