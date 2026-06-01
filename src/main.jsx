import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

// Patches de segurança globais para evitar que erros de desalocação e inserção de bibliotecas de terceiros (Recharts, Drag&Drop) travem o React
if (typeof window !== 'undefined' && window.Node && window.Node.prototype) {
  // Patch para removeChild
  const originalRemoveChild = window.Node.prototype.removeChild;
  window.Node.prototype.removeChild = function (child) {
    if (child.parentNode !== this) {
      return child;
    }
    return originalRemoveChild.call(this, child);
  };

  // Patch para insertBefore
  const originalInsertBefore = window.Node.prototype.insertBefore;
  window.Node.prototype.insertBefore = function (newNode, referenceNode) {
    if (referenceNode && referenceNode.parentNode !== this) {
      return originalInsertBefore.call(this, newNode, null); // Fallback para appendChild seguro
    }
    return originalInsertBefore.call(this, newNode, referenceNode);
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)