import { Navigate } from 'react-router-dom';

// O cadastro público foi desativado. Contas são criadas exclusivamente por
// administradores em /usuarios, o que também protege o login Microsoft contra
// acessos de pessoas que ainda não foram previamente cadastradas.
export default function Register() {
  return <Navigate to="/login" replace />;
}
