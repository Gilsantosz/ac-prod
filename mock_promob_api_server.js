import http from 'http';

const PORT = 8787;

const MOCK_XML = `<?xml version="1.0" encoding="utf-8"?>
<Project Code="PROJ-001" Name="Apartamento Decorado" CustomerName="Gilberto Santos" OrderCode="LM-SM-T9988" Date="2026-06-17">
  <Room Name="Cozinha">
    <Module Name="Armario Superior" Code="MOD-001">
      <Part Code="PEC-001" Description="Lateral Esquerda" Material="MDF" Color="Branco" Thickness="18" Width="350" Height="700" Quantity="1" EdgeLeft="PVC 0.45" EdgeRight="PVC 0.45" />
      <Part Code="PEC-002" Description="Lateral Direita" Material="MDF" Color="Branco" Thickness="18" Width="350" Height="700" Quantity="1" EdgeLeft="PVC 0.45" EdgeRight="PVC 0.45" />
      <Part Code="PEC-003" Description="Prateleira Movel" Material="MDF" Color="Branco" Thickness="15" Width="340" Height="564" Quantity="2" HasCNC="true" />
      <Part Code="PEC-004" Description="Porta Sorrento" Material="MDF" Color="Louro Freijo" Thickness="18" Width="396" Height="696" Quantity="1" EdgeFront="PVC 1.0" EdgeBack="PVC 1.0" EdgeLeft="PVC 1.0" EdgeRight="PVC 1.0" ProductType="sorrentos" />
    </Module>
  </Room>
  <Room Name="Quarto Casal">
    <Module Name="Guarda Roupa" Code="MOD-002">
      <Part Code="PEC-005" Description="Porta Pivotante Espelhada" Material="MDF" Color="Espelho" Thickness="22" Width="600" Height="2200" Quantity="2" ProductType="pivot_door" />
    </Module>
  </Room>
</Project>`;

const server = http.createServer((req, res) => {
  // Configuração de CORS para permitir requisições de qualquer origem
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  console.log(`[Mock Promob Server] Recebeu requisição: ${req.method} ${req.url}`);

  // Verifica se o cabeçalho Authorization está presente
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    console.warn('[Mock Promob Server] Chamada sem cabeçalho Authorization!');
  } else {
    console.log(`[Mock Promob Server] Token recebido: ${authHeader}`);
  }

  // Responde com o XML mockado
  res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
  res.end(MOCK_XML);
});

server.listen(PORT, () => {
  console.log(`[Mock Promob Server] Servidor rodando em http://localhost:${PORT}`);
  console.log(`[Mock Promob Server] Retornando XML mockado para todas as rotas.`);
});
