// Edge Function: promob-parse-order
// Parseia XML do Promob e retorna JSON normalizado
// Esta função é usada internamente pelas outras Edge Functions

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { XMLParser } from "npm:fast-xml-parser@4.5.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { xmlContent } = await req.json();
    if (!xmlContent) throw new Error("xmlContent é obrigatório");

    const parsed = parsePromobXml(xmlContent);
    return new Response(JSON.stringify({ success: true, data: parsed }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

function stringify(value) {
  if (value == null) return "";
  if (typeof value === "object") return stringify(value["#text"] ?? "");
  return String(value);
}

function ensureArray(val) {
  if (val == null) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

function parsePromobXml(xmlString) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    allowBooleanAttributes: true,
    trimValues: true,
  });
  
  const parsedXml = parser.parse(xmlString);
  
  let project = { code: "", name: "", customer: "", orderCode: "", date: "", deliveryDate: "" };
  let allItems = [];
  let environments = [];

  // --- Estrutura A: PromobERPIntegration ---
  const erpIntegration = parsedXml.PromobERPIntegration || parsedXml.promoberpintegration;
  if (erpIntegration) {
    const projeto = erpIntegration.Projeto || erpIntegration.projeto || {};
    const cli = projeto.Dados_Cliente?.CLIENTE_LOJA || {};
    const op = projeto.OrdemProducao || {};
    
    project.code = stringify(projeto.Codigo || projeto.ID_PROMOB);
    project.name = stringify(projeto.Nome);
    project.customer = stringify(cli.Nome || cli.name);
    project.orderCode = stringify(op.Codigo || op.codigo || projeto.Codigo);
    project.date = stringify(erpIntegration.CreatedAt || erpIntegration.createdat).split("T")[0] || new Date().toISOString().split("T")[0];
    project.deliveryDate = stringify(op.DataEntrega || op.dataentrega);

    const envs = ensureArray(projeto.Ambientes?.Ambiente || projeto.ambientes?.ambiente);
    for (const envEl of envs) {
      const envName = stringify(envEl.Nome || envEl.nome || "Ambiente");
      const env = { id: envName, name: envName, modules: [] };

      const mods = ensureArray(envEl.Modulo || envEl.modulo);
      for (const modEl of mods) {
        const modName = stringify(modEl.Nome || modEl.nome || "Módulo");
        const mod = { id: stringify(modEl.ID_PROMOB || modEl.id_promob), name: modName, items: [] };

        const items = ensureArray(modEl.Item || modEl.item);
        for (const itemEl of items) {
          const code = stringify(itemEl.Codigo || itemEl.codigo);
          const name = stringify(itemEl.Descricao || itemEl.descricao || code);
          const material = stringify(itemEl.Material || itemEl.material);
          const color = stringify(itemEl.Cor || itemEl.cor);
          
          const dim = itemEl.Dimensoes || itemEl.dimensoes || {};
          const thickness = parseFloat(stringify(dim.Espessura || dim.espessura || "0")) || 0;
          const width = parseFloat(stringify(dim.Comprimento || dim.comprimento || "0")) || 0;
          const height = parseFloat(stringify(dim.Largura || dim.largura || "0")) || 0;
          const quantity = parseInt(stringify(itemEl.Quantidade || itemEl.quantidade || "1")) || 1;

          let edgeFront = "", edgeBack = "", edgeLeft = "", edgeRight = "";
          const bordas = ensureArray(itemEl.Bordas?.Borda || itemEl.bordas?.borda);
          for (const b of bordas) {
            const lado = stringify(b.Lado || b.lado).toLowerCase();
            const aplicar = stringify(b.Aplicar || b.aplicar);
            if (aplicar === "S" || aplicar === "true") {
              const val = stringify(b.Espessura || b.espessura || "Sim");
              if (lado.includes("front")) edgeFront = val;
              else if (lado.includes("tras") || lado.includes("back")) edgeBack = val;
              else if (lado.includes("esq") || lado.includes("left")) edgeLeft = val;
              else if (lado.includes("dir") || lado.includes("right")) edgeRight = val;
            }
          }

          const reqs = itemEl.Requisitos || itemEl.requisitos || {};
          const requiresCnc = stringify(reqs.Usinagem || reqs.usinagem) === "S" || stringify(reqs.CNC || reqs.cnc) === "S";
          const requiresJoinery = stringify(reqs.Marcenaria || reqs.marcenaria) === "S";
          const requiresEdge = stringify(reqs.Bordo || reqs.bordo) === "S";
          const requiresCut = stringify(reqs.Corte || reqs.corte) === "S" || true;

          const item = {
            code, name, material, color, thickness, width, height, quantity,
            edgeFront, edgeBack, edgeLeft, edgeRight,
            requiresCut, requiresEdge, requiresCnc, requiresJoinery,
            requiresSeparation: true, requiresPackaging: true, requiresShipping: true,
            environmentName: envName, moduleName: modName,
            rawAttributes: {},
          };
          mod.items.push(item);
          allItems.push(item);
        }
        env.modules.push(mod);
      }
      environments.push(env);
    }
  }
  // --- Estrutura B: PromobExport (AC.Prod manual format) ---
  else if (parsedXml.PromobExport || parsedXml.promobexport) {
    const exportEl = parsedXml.PromobExport || parsedXml.promobexport;
    const cabecalho = exportEl.Cabecalho || exportEl.cabecalho || {};
    const ordens = ensureArray(exportEl.OrdensProducao?.OrdemProducao || exportEl.ordensproducao?.ordemproducao);
    
    if (ordens.length > 0) {
      const op = ordens[0];
      const cli = op.Cliente || op.cliente || {};
      project.code = stringify(op.Pedido || op.numeropedido || "OP");
      project.name = stringify(cabecalho.Descricao || "Importação Promob");
      project.customer = stringify(cli.RazaoSocial || cli.razaosocial || cli.NomeFantasia);
      project.orderCode = stringify(op.Pedido || op.numeropedido);
      project.date = stringify(exportEl.geradoEm || exportEl.geradoem).split("T")[0] || new Date().toISOString().split("T")[0];
      project.deliveryDate = stringify(op.DataFinalizacao || op.datafinalizacao);

      for (const opEl of ordens) {
        const lotes = ensureArray(opEl.Lotes?.Lote || opEl.lotes?.lote);
        for (const loteEl of lotes) {
          const prod = loteEl.Produto || loteEl.produto || {};
          const envName = stringify(prod.Ambiente || prod.ambiente || "Ambiente");
          const modName = stringify(prod.Nome || prod.nome || "Módulo");
          
          let env = environments.find(e => e.name === envName);
          if (!env) {
            env = { id: envName, name: envName, modules: [] };
            environments.push(env);
          }

          let mod = env.modules.find(m => m.name === modName);
          if (!mod) {
            mod = { id: modName, name: modName, items: [] };
            env.modules.push(mod);
          }

          const pecas = ensureArray(loteEl.Pecas?.Peca || loteEl.pecas?.peca);
          for (const pecaEl of pecas) {
            const code = stringify(pecaEl.PecaId || pecaEl.pecaid || pecaEl.id);
            const name = stringify(pecaEl.Nome || pecaEl.nome || code);
            const material = stringify(pecaEl.Material || pecaEl.material);
            const color = stringify(pecaEl.CorPadrao || pecaEl.corpadrao || pecaEl.Cor || pecaEl.cor);
            
            const med = pecaEl.MedidasCorte || pecaEl.medidascorte || {};
            const thickness = parseFloat(stringify(med.Espessura || med.espessura || pecaEl.Thickness || "0")) || 0;
            const width = parseFloat(stringify(med.Comprimento || med.comprimento || pecaEl.Width || "0")) || 0;
            const height = parseFloat(stringify(med.Largura || med.largura || pecaEl.Height || "0")) || 0;
            const quantity = parseInt(stringify(pecaEl.Quantidade || pecaEl.quantidade || "1")) || 1;

            const fitas = pecaEl.FitasBorda || pecaEl.fitasborda || {};
            const cleanEdge = (val) => {
              const s = stringify(val);
              return (s.toUpperCase() === "SEM FITA" || s === "") ? "" : s;
            };
            const edgeFront = cleanEdge(fitas.Frente || fitas.frente);
            const edgeBack = cleanEdge(fitas.Tras || fitas.tras || fitas.Traseira || fitas.traseira);
            const edgeLeft = cleanEdge(fitas.Esquerda || fitas.esquerda);
            const edgeRight = cleanEdge(fitas.Direita || fitas.direita);

            const hasEdge = [edgeFront, edgeBack, edgeLeft, edgeRight].some(e => !!e);

            const roteiroStr = stringify(pecaEl.RoteiroProdutivo || pecaEl.roteiroprodutivo).toUpperCase();
            const requiresCnc = roteiroStr.includes("CNC") || roteiroStr.includes("FURACAO") || roteiroStr.includes("USINAGEM");
            const requiresJoinery = roteiroStr.includes("MARCENARIA");
            const requiresEdge = roteiroStr.includes("BORDAS") || roteiroStr.includes("BORDO") || hasEdge;

            const item = {
              code, name, material, color, thickness, width, height, quantity,
              edgeFront, edgeBack, edgeLeft, edgeRight,
              requiresCut: true, requiresEdge, requiresCnc, requiresJoinery,
              requiresSeparation: true, requiresPackaging: true, requiresShipping: true,
              environmentName: envName, moduleName: modName,
              rawAttributes: {},
            };
            mod.items.push(item);
            allItems.push(item);
          }
        }
      }
    }
  }
  // --- Estrutura C: Padrão fallback original ---
  else {
    const projectEl = parsedXml.Project || parsedXml.project || firstObjectValue(parsedXml) || {};
    
    const getAttr = (el, attr, fallback = "") =>
      stringify(el?.[attr] ?? el?.[attr.toLowerCase()] ?? fallback);

    const getNestedText = (el, path, fallback = "") => {
      const parts = path.split(">").map((p) => p.trim()).filter(Boolean);
      let value = el;
      for (const part of parts) {
        value = value?.[part] ?? value?.[part.toLowerCase()];
        if (value == null) return fallback;
      }
      return stringify(value?.["#text"] ?? value ?? fallback);
    };

    project.code = getAttr(projectEl, "Code") || getAttr(projectEl, "id");
    project.name = getAttr(projectEl, "Name") || getNestedText(projectEl, "ProjectName");
    project.customer = getAttr(projectEl, "CustomerName") || getNestedText(projectEl, "Customer > Name");
    project.orderCode = getAttr(projectEl, "OrderCode") || getAttr(projectEl, "Order");
    project.date = getAttr(projectEl, "Date") || new Date().toISOString().split("T")[0];
    project.deliveryDate = getAttr(projectEl, "DeliveryDate");

    const envEls = collectNodes(projectEl, ["Environment", "Room", "Ambiente", "Environments", "Ambientes"]);
    for (const envEl of envEls) {
      const envName = getAttr(envEl, "Name") || getAttr(envEl, "Description") || "Ambiente";
      const env = {
        id:   getAttr(envEl, "id") || getAttr(envEl, "Code") || envName,
        name: envName,
        modules: [],
      };

      const moduleEls = collectNodes(envEl, ["Module", "Modulo", "Modules", "Modulos"]);
      for (const modEl of moduleEls) {
        const modName = getAttr(modEl, "Name") || getAttr(modEl, "Description") || "Módulo";
        const mod = {
          id:   getAttr(modEl, "id") || getAttr(modEl, "Code") || modName,
          name: modName,
          items: [],
        };

        const itemEls = collectNodes(modEl, ["Item", "Part", "Peca", "Piece", "Items", "Parts", "Pecas", "Pieces"]);
        for (const itemEl of itemEls) {
          const item = parseItemFallback(itemEl, env.name, mod.name);
          mod.items.push(item);
          allItems.push(item);
        }

        if (mod.items.length === 0) {
          const allItemsFallback = collectNodes(modEl, ["Item", "Part"]);
          for (const el of allItemsFallback) {
            const item = parseItemFallback(el, env.name, mod.name);
            mod.items.push(item);
            allItems.push(item);
          }
        }
        env.modules.push(mod);
      }
      environments.push(env);
    }

    if (environments.length === 0) {
      const flatEnv = {
        id: "default",
        name: "Projeto",
        modules: [{ id: "default", name: "Módulo Principal", items: [] }],
      };
      const allItemsFallback = collectNodes(projectEl, ["Item", "Part", "Piece", "Peca"]);
      for (const el of allItemsFallback) {
        const item = parseItemFallback(el, "Projeto", "Módulo Principal");
        flatEnv.modules[0].items.push(item);
        allItems.push(item);
      }
      if (flatEnv.modules[0].items.length > 0) environments.push(flatEnv);
    }
  }

  let totalPieces = 0;
  let requiresJoinery = false;

  for (const item of allItems) {
    totalPieces += item.quantity || 1;
    if (item.requiresJoinery) requiresJoinery = true;
  }

  return {
    project,
    environments,
    allItems,
    summary: {
      totalPieces,
      totalItems:      allItems.length,
      requiresJoinery,
      requiresCnc:     allItems.some(i => i.requiresCnc),
      requiresEdge:    allItems.some(i => i.requiresEdge),
      environments:    environments.length,
      modules:         environments.reduce((a, e) => a + e.modules.length, 0),
    },
  };
}

function parseItemFallback(el, envName = "", modName = "") {
  const getAttr = (attr) => stringify(el?.[attr] ?? el?.[attr.toLowerCase()] ?? "");
  const getText  = (sel) => stringify(el?.[sel]?.["#text"] ?? el?.[sel] ?? "");

  const code     = getAttr("Code") || getAttr("id") || getAttr("PartCode");
  const name     = getAttr("Description") || getAttr("Name") || getText("Description") || code;
  const material = getAttr("Material") || getAttr("Board") || getText("Material");
  const color    = getAttr("Color") || getAttr("Grain") || getText("Color");
  const thickness = parseFloat(getAttr("Thickness") || getAttr("Esp") || "0") || 0;
  const width    = parseFloat(getAttr("Width") || getAttr("Larg") || "0") || 0;
  const height   = parseFloat(getAttr("Height") || getAttr("Alt") || "0") || 0;
  const quantity = parseInt(getAttr("Quantity") || getAttr("Qty") || "1") || 1;

  const edgeFront = getAttr("EdgeFront") || getAttr("Borda1") || "";
  const edgeBack  = getAttr("EdgeBack")  || getAttr("Borda2") || "";
  const edgeLeft  = getAttr("EdgeLeft")  || getAttr("Borda3") || "";
  const edgeRight = getAttr("EdgeRight") || getAttr("Borda4") || "";

  const hasEdge = [edgeFront, edgeBack, edgeLeft, edgeRight].some(e => !!e);

  const cncOps = collectNodes(el, ["Operation", "Usinagem", "CNC", "Machining"]);
  const requiresCnc = cncOps.length > 0 || !!getAttr("HasCNC") || !!getAttr("HasMachining");

  const itemType = (getAttr("Type") || getAttr("ProductType") || "").toLowerCase();
  const requiresJoinery =
    getAttr("RequiresJoinery") === "true" ||
    getAttr("Marcenaria") === "true" ||
    itemType.includes("porta") ||
    itemType.includes("door") ||
    itemType.includes("grelhad") ||
    itemType.includes("garlhad") ||
    itemType.includes("pivot") ||
    itemType.includes("sorrento") ||
    itemType.includes("especial") ||
    itemType.includes("refinado");

  return {
    code,
    name,
    material,
    color,
    thickness,
    width,
    height,
    quantity,
    edgeFront,
    edgeBack,
    edgeLeft,
    edgeRight,
    requiresCut:      true,
    requiresEdge:     hasEdge,
    requiresCnc,
    requiresJoinery,
    requiresSeparation: true,
    requiresPackaging:  true,
    requiresShipping:   true,
    environmentName:  envName,
    moduleName:       modName,
    rawAttributes:    {},
  };
}

function collectNodes(source, names) {
  const result = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    for (const name of names) {
      const value = node[name] ?? node[name.toLowerCase()];
      if (Array.isArray(value)) result.push(...value);
      else if (value && typeof value === "object") result.push(value);
    }
  };
  visit(source);
  return result;
}

function firstObjectValue(obj) {
  return Object.values(obj || {}).find((value) => value && typeof value === "object");
}
