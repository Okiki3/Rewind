import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = express()
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')
const staticOptions = { immutable: true, maxAge: '1y', index: false }

app.get('/health', (_request, response) => response.json({ ok: true, service: 'rewind' }))
app.use('/rewind/sdk', express.static(path.join(root, 'sdk'), { maxAge: '5m', index: false }))
app.use('/rewind', express.static(root, staticOptions))
app.use(express.static(root, staticOptions))
app.use((_request, response) => response.sendFile(path.join(root, 'index.html')))

const port = Number(process.env.PORT || 4173)
app.listen(port, '0.0.0.0', () => console.log(`REWIND listening on ${port}`))
