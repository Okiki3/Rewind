import './polyfills'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import MainnetDemo from './MainnetDemo'
import './styles.css'

const search = new URLSearchParams(window.location.search)
const showMainnetDemo = search.get('network') === 'mainnet' && search.get('demo') === '1'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {showMainnetDemo ? <MainnetDemo /> : <App />}
  </StrictMode>,
)

