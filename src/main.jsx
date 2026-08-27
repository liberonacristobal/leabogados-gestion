import React from 'react'
import ReactDOM from 'react-dom/client'
import App, { PortalApp } from './App.jsx'

// Modo portal del cliente: /portal (o ?portal=1) → página externa con login por correo, separada del app interno.
const esPortal = window.location.pathname.replace(/\/+$/,'') === '/portal' || new URLSearchParams(window.location.search).get('portal') === '1'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {esPortal ? <PortalApp /> : <App />}
  </React.StrictMode>
)
// Tue Jun  9 17:43:53 -04 2026
