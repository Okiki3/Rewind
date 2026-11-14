import './polyfills'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import OwnerDeploy from './OwnerDeploy'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname.replace(/\/$/, '') === '/rewind/owner-deploy' ? <OwnerDeploy /> : <App />}
  </StrictMode>,
)

