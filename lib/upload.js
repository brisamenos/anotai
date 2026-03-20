// ═══════════════════════════════════════════════════════
// lib/upload.js — Upload de imagens
// ═══════════════════════════════════════════════════════
'use strict'

const fs   = require('fs')
const path = require('path')
const { UPLOADS_DIR, log } = require('./db')

function handleUpload(req, res, sendFn) {
  return new Promise(resolve => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      try {
        const buffer    = Buffer.concat(chunks)
        const ct        = req.headers['content-type'] || ''
        const boundary  = ct.split('boundary=')[1]
        const urlPath   = req.url || ''
        const urlBase   = path.basename(urlPath.split('?')[0])
        const hasExt    = /\.(jpg|jpeg|png|webp|gif)$/i.test(urlBase)
        const fnameURL  = hasExt ? urlBase : null

        let fname = fnameURL || `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`

        if (!boundary) {
          // JSON payload com base64
          const body = JSON.parse(buffer.toString())
          const ext  = (body.mime || 'image/jpeg').split('/')[1] || 'jpg'
          if (!fnameURL) fname = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
          fs.writeFileSync(path.join(UPLOADS_DIR, fname), Buffer.from(body.data, 'base64'))
        } else {
          // multipart/form-data
          const raw   = buffer.toString('binary')
          const parts = raw.split('--' + boundary).filter(p => p.includes('filename='))
          if (parts.length) {
            const [head, ...bodyParts] = parts[0].split('\r\n\r\n')
            const fnMatch = head.match(/filename="([^"]+)"/)
            if (!fnameURL && fnMatch) {
              const ext = path.extname(fnMatch[1]) || '.jpg'
              fname = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
            }
            const fileContent = bodyParts.join('\r\n\r\n').replace(/\r\n$/, '')
            fs.writeFileSync(path.join(UPLOADS_DIR, fname), Buffer.from(fileContent, 'binary'))
          } else {
            fs.writeFileSync(path.join(UPLOADS_DIR, fname), buffer)
          }
        }

        log('📸', `Upload: ${fname}`)
        const url = `/uploads/${fname}`
        resolve(sendFn(res, 200, { url, publicUrl: url }))
      } catch(e) {
        log('❌', 'Upload error:', { error: e.message })
        resolve(sendFn(res, 400, { error: e.message }))
      }
    })
  })
}

module.exports = { handleUpload }
