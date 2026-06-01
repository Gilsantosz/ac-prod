import { createClient } from '@supabase/supabase-js';

// ✅ SEGURO: Apenas a chave anon (pública) é usada no frontend.
// A SERVICE_ROLE_KEY nunca é usada aqui — toda autorização é controlada por RLS no PostgreSQL.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '[AC.Prod] Supabase não configurado. Crie um arquivo .env com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
