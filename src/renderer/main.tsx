/**
 * Desktop client renderer entry.
 * @module desktop/renderer/main
 */

import { createRoot } from 'react-dom/client'
import { App } from './app'
import './styles/tokens.css'
import './styles/app.css'

const el = document.getElementById('root')
if (el === null) throw new Error('desktop renderer: missing #root')
createRoot(el).render(<App />)
