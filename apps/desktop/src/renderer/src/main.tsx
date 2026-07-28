import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App.js'
import './styles/base.css'

// 在 React 挂载前先定一次主题，避免首帧闪一下浅色再跳深色
document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches
  ? 'dark'
  : 'light'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
