import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = express()
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')
const staticOptions = { immutable: true, maxAge: '1y', index: false }

app.get('/health', (_request, response) => response.json({ ok: true, service: 'rewind' }))
// SDK code and types are intentionally public so third-party wallet
// websites can import the ESM module. No signing keys or credentials live here.
app.use('/rewind/sdk', (_request, response, next) => {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  next()
})
// The .ts extension is otherwise misidentified as an MPEG transport stream.
// This file contains public TypeScript declarations, not video content.
app.get('/rewind/sdk/index.d.ts', (_request, response) => {
  response.type('text/plain').sendFile(path.join(root, 'sdk', 'index.d.ts'))
})
app.use('/rewind/sdk', express.static(path.join(root, 'sdk'), { maxAge: '5m', index: false, dotfiles: 'deny' }))
// Do not serve the website HTML as if a missing SDK JavaScript file existed.
app.use('/rewind/sdk', (_request, response) => response.status(404).type('text/plain').send('SDK file not found'))
app.use('/rewind', express.static(root, staticOptions))
app.use(express.static(root, staticOptions))
app.use((_request, response) => response.sendFile(path.join(root, 'index.html')))

const port = Number(process.env.PORT || 4173)
app.listen(port, '0.0.0.0', () => console.log(`REWIND listening on ${port}`))
