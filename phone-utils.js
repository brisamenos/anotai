'use strict'

const PHONE_LOOKUP_SLOT_COUNT = 16
const PHONE_NO_MATCH = '__NO_PHONE_MATCH__'

function rawPhonePart(raw) {
  return String(raw || '').trim().split('@')[0].split(':')[0]
}

function cleanPhoneDigits(raw) {
  return rawPhonePart(raw).replace(/\D/g, '')
}

function cleanWhatsappJid(jid) {
  const value = String(jid || '').trim()
  if (!value || value.endsWith('@lid')) return ''
  return cleanPhoneDigits(value)
}

function stripBrazilCountry(digits) {
  const value = String(digits || '')
  return value.startsWith('55') && value.length > 11 ? value.slice(2) : value
}

function stripTrunkZero(digits) {
  return String(digits || '').replace(/^0+(?=\d{10,11}$)/, '')
}

function phoneLookupVariants(raw) {
  const clean = cleanPhoneDigits(raw)
  const out = new Set()
  const add = (value) => {
    const digits = String(value || '').replace(/\D/g, '')
    if (digits.length >= 8) out.add(digits)
  }

  add(clean)
  add(stripBrazilCountry(clean))
  add(stripTrunkZero(stripBrazilCountry(clean)))

  const baseValues = Array.from(out)
  for (const value of baseValues) {
    const national = stripTrunkZero(stripBrazilCountry(value))
    add(national)

    if (/^\d{2}9\d{8}$/.test(national)) {
      add(national.slice(0, 2) + national.slice(3))
    }

    if (/^\d{10}$/.test(national)) {
      add(national.slice(0, 2) + '9' + national.slice(2))
    }
  }

  for (const value of Array.from(out)) {
    const national = stripTrunkZero(stripBrazilCountry(value))
    if (/^\d{10,11}$/.test(national)) {
      add(national)
      add('55' + national)
      add('0' + national)
    }
  }

  return Array.from(out).slice(0, PHONE_LOOKUP_SLOT_COUNT)
}

function paddedPhoneVariants(raw) {
  const variants = phoneLookupVariants(raw)
  while (variants.length < PHONE_LOOKUP_SLOT_COUNT) {
    variants.push(PHONE_NO_MATCH + variants.length)
  }
  return variants
}

function phoneLookupArgs(raw) {
  const variants = paddedPhoneVariants(raw)
  return [...variants, ...variants, ...variants]
}

function phoneDigitsSql(col = 'phone') {
  const chars = ["'+'", "' '", "'-'", "'('", "')'", "'.'", "'/'", 'char(9)', 'char(10)', 'char(13)']
  return chars.reduce((expr, ch) => `replace(${expr},${ch},'')`, `COALESCE(${col},'')`)
}

function phoneLookupSql(col = 'phone') {
  const c = phoneDigitsSql(col)
  const q = Array(PHONE_LOOKUP_SLOT_COUNT).fill('?').join(',')
  return `(${c} IN (${q}) OR substr(${c}, -11) IN (${q}) OR substr(${c}, -10) IN (${q}))`
}

function phonesMatch(a, b) {
  const variantsA = new Set(phoneLookupVariants(a))
  return phoneLookupVariants(b).some((variant) => variantsA.has(variant))
}

module.exports = {
  cleanPhoneDigits,
  cleanWhatsappJid,
  phoneLookupArgs,
  phoneLookupSql,
  phoneLookupVariants,
  phonesMatch
}
