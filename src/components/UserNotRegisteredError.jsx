import React from 'react';
import { useAuth } from '@/lib/AuthContext';

const UserNotRegisteredError = () => {
  const { authError, logout } = useAuth();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-white to-slate-50">
      <div className="max-w-md w-full p-8 bg-white rounded-lg shadow-lg border border-slate-100">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-full bg-orange-100">
            <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-4">Acesso Restrito</h1>
          <p className="text-slate-600 mb-8">
            {authError?.message || 'Você não está cadastrado para usar esta aplicação. Entre em contato com o administrador do sistema para solicitar acesso.'}
          </p>
          <div className="p-4 bg-slate-50 rounded-md text-sm text-slate-600">
            <p>Se você acredita que isso é um erro, você pode:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Verificar se você está logado com a conta correta</li>
              <li>Entrar em contato com o administrador para solicitar permissão</li>
              <li>Tentar sair do sistema e fazer login novamente</li>
            </ul>
          </div>
          <button
            type="button"
            onClick={() => logout(true)}
            className="mt-6 w-full rounded-lg bg-[#00552f] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#004326]"
          >
            Voltar para o login
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserNotRegisteredError;
