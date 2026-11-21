// Área de entrega no mapa (cobrança "Por distância").
//
// Este arquivo é usado em três lugares, com a MESMA conta, para os três
// sempre concordarem sobre a taxa:
//   - gestor (desenha os círculos e as áreas no mapa)
//   - cardápio (calcula a taxa pelo pino do cliente)
//   - servidor (confere a taxa e recusa pedido fora da área)
//
// Como a taxa sai, nesta ordem:
//   1. Ponto dentro de uma área marcada "Não entrego"  -> não entrega
//   2. Ponto dentro de uma área com taxa própria       -> taxa dessa área
//   3. Senão, distância em linha reta até a loja       -> faixa de km
//   4. Mais longe que a maior faixa                    -> fora da área
//
// delivery_fee_config.areas = [{ id, nome, tipo: 'taxa'|'bloqueio', taxa, pontos: [[lat,lng], ...] }]
;(function (raiz) {
  function num(v) { const n = parseFloat(v); return isFinite(n) ? n : NaN }
  function pontoValido(lat, lng) {
    return isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
  }

  function distKm(lat1, lng1, lat2, lng2) {
    const R = 6371
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLng = (lng2 - lng1) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }

  // Ponto dentro do desenho (regra do "raio que cruza as bordas")
  function dentro(lat, lng, pontos) {
    let d = false
    for (let i = 0, j = pontos.length - 1; i < pontos.length; j = i++) {
      const yi = pontos[i][0], xi = pontos[i][1], yj = pontos[j][0], xj = pontos[j][1]
      if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi)) d = !d
    }
    return d
  }

  function areasValidas(cfg) {
    const lista = Array.isArray(cfg && cfg.areas) ? cfg.areas : []
    return lista.filter(a => a && Array.isArray(a.pontos) && a.pontos.length >= 3 &&
      a.pontos.every(p => Array.isArray(p) && pontoValido(num(p[0]), num(p[1]))))
  }

  function faixasValidas(cfg) {
    const lista = Array.isArray(cfg && cfg.faixas) ? cfg.faixas : []
    return lista.map(f => ({ ate_km: num(f && f.ate_km), taxa: num(f && f.taxa) || 0 }))
      .filter(f => f.ate_km > 0).sort((a, b) => a.ate_km - b.ate_km)
  }

  // cfg: delivery_fee_config. loja: {lat,lng}. ponto: {lat,lng} do cliente.
  // Retorna { ok, taxa, distKm, origem: 'area'|'faixa', area, faixa, motivo, bloqueado, fora, maxKm }
  function calcular(cfg, loja, ponto) {
    const lat = num(ponto && ponto.lat), lng = num(ponto && ponto.lng)
    if (!pontoValido(lat, lng)) return { ok: false, semPonto: true, motivo: 'Marque no mapa onde a entrega deve chegar.' }
    const lLat = num(loja && loja.lat), lLng = num(loja && loja.lng)
    const temLoja = pontoValido(lLat, lLng)
    const dist = temLoja ? distKm(lLat, lLng, lat, lng) : null
    const areas = areasValidas(cfg)

    const bloqueio = areas.find(a => a.tipo === 'bloqueio' && dentro(lat, lng, a.pontos))
    if (bloqueio) {
      return { ok: false, bloqueado: true, distKm: dist, area: bloqueio.nome || '',
        motivo: 'Infelizmente não entregamos nesse local' + (bloqueio.nome ? ` (${bloqueio.nome})` : '') + '.' }
    }
    const area = areas.find(a => a.tipo !== 'bloqueio' && dentro(lat, lng, a.pontos))
    if (area) return { ok: true, taxa: num(area.taxa) || 0, distKm: dist, origem: 'area', area: area.nome || 'Área especial' }

    const faixas = faixasValidas(cfg)
    if (!temLoja) return { ok: false, semLoja: true, motivo: 'A loja ainda não marcou a localização dela no mapa.' }
    const i = faixas.findIndex(f => dist <= f.ate_km + 0.001)
    if (i >= 0) return { ok: true, taxa: faixas[i].taxa, distKm: dist, origem: 'faixa', faixa: faixas[i], faixaIdx: i }
    const maxKm = faixas.length ? faixas[faixas.length - 1].ate_km : 0
    return { ok: false, fora: true, distKm: dist, maxKm,
      motivo: `Esse endereço está a ${dist.toFixed(1).replace('.', ',')} km da loja, fora da área de entrega` +
        (maxKm ? ` (até ${String(maxKm).replace('.', ',')} km).` : '.') }
  }

  // A loja tem alguma área desenhada ou faixa de km? (senão a config está incompleta)
  function temAreaConfigurada(cfg) { return faixasValidas(cfg).length > 0 || areasValidas(cfg).some(a => a.tipo !== 'bloqueio') }

  // Só no navegador: carrega o Leaflet (mapa grátis do OpenStreetMap) uma vez
  const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js'
  const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css'
  const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
  const TILES_CREDITO = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  let _carregando = null
  function carregarLeaflet() {
    if (typeof window === 'undefined') return Promise.reject(new Error('sem navegador'))
    if (window.L && window.L.map) return Promise.resolve(window.L)
    if (_carregando) return _carregando
    _carregando = new Promise((ok, falha) => {
      if (!document.querySelector('link[data-leaflet]')) {
        const css = document.createElement('link')
        css.rel = 'stylesheet'; css.href = LEAFLET_CSS; css.setAttribute('data-leaflet', '1')
        document.head.appendChild(css)
      }
      const s = document.createElement('script')
      s.src = LEAFLET_JS; s.async = true
      s.onload = () => (window.L && window.L.map) ? ok(window.L) : falha(new Error('Leaflet não carregou'))
      s.onerror = () => { _carregando = null; falha(new Error('Sem internet para carregar o mapa')) }
      document.head.appendChild(s)
    })
    return _carregando
  }
  function camadaMapa(L) {
    return L.tileLayer(TILES, { maxZoom: 19, attribution: TILES_CREDITO })
  }

  // Procura um endereço (Nominatim, grátis). perto: {lat,lng} para dar
  // preferência a resultados perto da loja.
  async function buscarEndereco(texto, perto) {
    const q = String(texto || '').trim()
    if (q.length < 3) return []
    let url = 'https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=br&accept-language=pt-BR&q=' + encodeURIComponent(q)
    if (perto && pontoValido(num(perto.lat), num(perto.lng))) {
      const d = 0.25 // ~25 km para cada lado
      url += `&viewbox=${perto.lng - d},${perto.lat + d},${perto.lng + d},${perto.lat - d}`
    }
    const r = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!r.ok) return []
    const lista = await r.json()
    return (Array.isArray(lista) ? lista : []).map(x => ({ lat: num(x.lat), lng: num(x.lon), nome: x.display_name || '' }))
      .filter(x => pontoValido(x.lat, x.lng))
  }

  const api = { distKm, dentro, calcular, areasValidas, faixasValidas, temAreaConfigurada, pontoValido,
    carregarLeaflet, camadaMapa, buscarEndereco }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else raiz.AreaEntrega = api
})(typeof window !== 'undefined' ? window : this)
