import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { startStaleBundleWatch } from './lib/staleBundle'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// F124: a page left open across a deploy reloads itself (or says so) instead of running the old build for weeks.
startStaleBundleWatch()
