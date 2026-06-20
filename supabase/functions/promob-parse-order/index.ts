// Edge Function: promob-parse-order
// Parseia XML do Promob e retorna JSON normalizado
// Esta função é usada internamente pelas outras Edge Functions

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4.5.0";

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

/**
 * Parser principal do XML Promob.
 * Suporta estrutura padrão do Promob (Project → Environments → Modules → Items)
 * Retorna JSON normalizado para gravar no banco.
 */
function parsePromobXml(xmlString) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    allowBooleanAttributes: true,
    trimValues: true,
  });
  const parsedXml = parser.parse(xmlString);
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

  // ─── Dados do Projeto ─────────────────────────────────────
  const project = {
    code:     getAttr(projectEl, "Code") || getAttr(projectEl, "id"),
    name:     getAttr(projectEl, "Name") || getNestedText(projectEl, "ProjectName"),
    customer: getAttr(projectEl, "CustomerName") || getNestedText(projectEl, "Customer > Name"),
    orderCode: getAttr(projectEl, "OrderCode") || getAttr(projectEl, "Order"),
    date:     getAttr(projectEl, "Date") || new Date().toISOString().split("T")[0],
    deliveryDate: getAttr(projectEl, "DeliveryDate"),
  };

  // ─── Ambientes/Módulos/Peças ──────────────────────────────
  const environments = [];
  const envEls = collectNodes(projectEl, ["Environment", "Room", "Ambiente"]);

  for (const envEl of envEls) {
    const env = {
      id:   getAttr(envEl, "id") || getAttr(envEl, "Code"),
      name: getAttr(envEl, "Name") || getAttr(envEl, "Description"),
      modules: [],
    };

    const moduleEls = collectNodes(envEl, ["Module", "Modulo"]);
    for (const modEl of moduleEls) {
      const mod = {
        id:   getAttr(modEl, "id") || getAttr(modEl, "Code"),
        name: getAttr(modEl, "Name") || getAttr(modEl, "Description"),
        items: [],
      };

      const itemEls = collectNodes(modEl, ["Item", "Part", "Peca", "Piece"]);
      for (const itemEl of itemEls) {
        const item = parseItem(itemEl, env.name, mod.name);
        mod.items.push(item);
      }

      // Itens diretamente no módulo (sem sub-agrupamento)
      if (mod.items.length === 0) {
        const allItems = collectNodes(modEl, ["Item", "Part"]);
        for (const el of allItems) {
          mod.items.push(parseItem(el, env.name, mod.name));
        }
      }

      env.modules.push(mod);
    }

    environments.push(env);
  }

  // Se não encontrou structure com environments, tenta parse plano
  if (environments.length === 0) {
    const flatEnv = {
      id: "default",
      name: "Projeto",
      modules: [{ id: "default", name: "Módulo Principal", items: [] }],
    };
    const allItems = collectNodes(projectEl, ["Item", "Part", "Piece", "Peca"]);
    for (const el of allItems) {
      flatEnv.modules[0].items.push(parseItem(el, "Projeto", "Módulo Principal"));
    }
    if (flatEnv.modules[0].items.length > 0) environments.push(flatEnv);
  }

  // ─── Estatísticas totais ──────────────────────────────────
  let totalPieces = 0;
  let requiresJoinery = false;
  const allItems = [];

  for (const env of environments) {
    for (const mod of env.modules) {
      for (const item of mod.items) {
        totalPieces += item.quantity || 1;
        if (item.requiresJoinery) requiresJoinery = true;
        allItems.push({ ...item, environmentName: env.name, moduleName: mod.name });
      }
    }
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

function parseItem(el, envName = "", modName = "") {
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

  // Bordas
  const edgeFront = getAttr("EdgeFront") || getAttr("Borda1") || "";
  const edgeBack  = getAttr("EdgeBack")  || getAttr("Borda2") || "";
  const edgeLeft  = getAttr("EdgeLeft")  || getAttr("Borda3") || "";
  const edgeRight = getAttr("EdgeRight") || getAttr("Borda4") || "";

  const hasEdge = [edgeFront, edgeBack, edgeLeft, edgeRight].some(e => !!e);

  // Operações de usinagem
  const cncOps = collectNodes(el, ["Operation", "Usinagem", "CNC", "Machining"]);
  const requiresCnc = cncOps.length > 0 || !!getAttr("HasCNC") || !!getAttr("HasMachining");

  // Marcenaria — detectar por atributo ou pelo tipo de produto
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
    requiresCut:      true,      // sempre
    requiresEdge:     hasEdge,
    requiresCnc,
    requiresJoinery,
    requiresSeparation: true,
    requiresPackaging:  true,
    requiresShipping:   true,
    environmentName:  envName,
    moduleName:       modName,
    rawAttributes:    Object.fromEntries(
      Object.entries(el || {}).filter(([, value]) => typeof value !== "object")
    ),
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

function stringify(value) {
  if (value == null) return "";
  if (typeof value === "object") return stringify(value["#text"] ?? "");
  return String(value);
}
