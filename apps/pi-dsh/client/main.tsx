/** Browser entry for the same GUI in Electron and the local Web server. */
import { createRoot } from 'react-dom/client'
import './styles/brand-font.css'
import './styles/base.css'
import './styles/corner-shape.css'
import './styles/design-platform.css'
import './styles/focus.css'
import './styles/scrollbar.css'
import './styles/gradient-shadow-text.css'
import './styles/shiki.css'
import { App } from './App.tsx'
import './base.css'

const root = document.getElementById('root')
if (root === null) throw new Error('GUI root element is missing')
createRoot(root).render(<App />)
