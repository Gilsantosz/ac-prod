import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Parse .env manually
try {
  const envContent = fs.readFileSync('.env', 'utf-8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      }
      process.env[key] = value;
    }
  });
} catch (e) {
  console.error("Could not read .env file:", e);
}

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing environment variables VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
  console.log("Current env:", process.env);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  // Sign in as admin
  console.log("Signing in as admin@prodview.com...");
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'admin@prodview.com',
    password: 'admin123'
  });
  if (authError) {
    console.error("Auth error:", authError);
    process.exit(1);
  }
  console.log("Authenticated successfully as:", authData.user.email);

  const cellName = 'Corte ';
  const resolvedCellId = '7d2cd8ad-a703-4d9b-af54-6f82ad93158a';
  
  // Date range 7 days ago to now
  const now = new Date();
  const d = new Date();
  d.setDate(d.getDate() - 7);
  const dateFrom = d.toISOString();
  const dateTo = now.toISOString();

  console.log("Testing parameters:");
  console.log("- cellName:", cellName);
  console.log("- resolvedCellId:", resolvedCellId);
  console.log("- dateFrom:", dateFrom);
  console.log("- dateTo:", dateTo);

  // Test 1: Full parameters as sent by frontend (with p_cell_id as null)
  try {
    const { data, error } = await supabase.rpc('get_collection_history', {
      p_cell_id: null,
      p_workstation_id: null,
      p_operator_id: null,
      p_shift: null,
      p_status: null,
      p_lot_id: null,
      p_limit: 50,
      p_offset: 0,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_cell_name: cellName
    });
    
    if (error) {
      console.error("Test 1 error:", error);
    } else {
      console.log(`Test 1 success: found ${data ? data.length : 0} items.`);
      if (data && data.length > 0) {
        console.log("First item:", {
          id: data[0].id,
          created_at: data[0].created_at,
          cell_name: data[0].cell_name,
          traceability_code: data[0].traceability_code
        });
      }
    }
  } catch (err) {
    console.error("Test 1 crash:", err);
  }

  // Test 2: Without dateTo
  try {
    const { data, error } = await supabase.rpc('get_collection_history', {
      p_cell_id: resolvedCellId,
      p_workstation_id: null,
      p_operator_id: null,
      p_shift: null,
      p_status: null,
      p_lot_id: null,
      p_limit: 50,
      p_offset: 0,
      p_date_from: dateFrom,
      p_date_to: null,
      p_cell_name: cellName
    });
    
    if (error) {
      console.error("Test 2 error:", error);
    } else {
      console.log(`Test 2 success (no dateTo): found ${data ? data.length : 0} items.`);
    }
  } catch (err) {
    console.error("Test 2 crash:", err);
  }

  // Test 3: Without dateFrom and dateTo
  try {
    const { data, error } = await supabase.rpc('get_collection_history', {
      p_cell_id: resolvedCellId,
      p_workstation_id: null,
      p_operator_id: null,
      p_shift: null,
      p_status: null,
      p_lot_id: null,
      p_limit: 50,
      p_offset: 0,
      p_date_from: null,
      p_date_to: null,
      p_cell_name: cellName
    });
    
    if (error) {
      console.error("Test 3 error:", error);
    } else {
      console.log(`Test 3 success (no dates): found ${data ? data.length : 0} items.`);
    }
  } catch (err) {
    console.error("Test 3 crash:", err);
  }

  // Test 4: Querying cells table directly to see if RLS is blocking select
  try {
    const { data, error } = await supabase.from('cells').select('*');
    if (error) {
      console.error("Cells query error:", error);
    } else {
      console.log(`Cells query success: found ${data ? data.length : 0} cells.`);
    }
  } catch (err) {
    console.error("Cells query crash:", err);
  }
}

test();
