const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MP_TOKEN = process.env.MERCADOPAGO_TOKEN;
const SITE_URL = process.env.SITE_URL;

const PRECOS = {
  "Básico": 50,
  "Intermediário": 70,
  "Avançado": 90,
  "Pacote Completo": 180
};

export async function handler(event) {
  const startedAt = Date.now();

  try {
    // LOG: método e caminho
    console.log("DEBUG: request", {
      method: event.httpMethod,
      path: event.path,
      ts: new Date().toISOString()
    });

    if (event.httpMethod !== "POST") {
      return json(405, { error: "Método não permitido. Use POST." });
    }

    const data = JSON.parse(event.body || "{}");
    const { nome, whatsapp, email, curso, modulo } = data;

    // LOG: dados recebidos (sem expor muito)
    console.log("DEBUG: payload", {
      hasNome: !!nome,
      hasWhatsapp: !!whatsapp,
      hasEmail: !!email,
      curso,
      modulo
    });

    if (!nome || !whatsapp || !email || !curso || !modulo) {
      return json(400, { error: "Dados incompletos" });
    }

    const valor = PRECOS[modulo];
    if (!valor) {
      console.log("DEBUG: modulo invalido recebido:", modulo);
      return json(400, { error: "Módulo inválido", received: modulo });
    }

    // LOG: env vars presentes (não imprime valores)
    console.log("DEBUG: env check", {
      hasSupabaseUrl: !!SUPABASE_URL,
      hasSupabaseKey: !!SUPABASE_KEY,
      hasMpToken: !!MP_TOKEN,
      hasSiteUrl: !!SITE_URL
    });

    if (!SUPABASE_URL || !SUPABASE_KEY || !MP_TOKEN || !SITE_URL) {
      return json(500, { error: "Variáveis de ambiente não configuradas no Netlify." });
    }

    // 1) Salvar no Supabase
    let inscricao = null;
    try {
      console.log("DEBUG: supabase insert ->", `${SUPABASE_URL}/rest/v1/inscricoes`);

      const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/inscricoes`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({ nome, whatsapp, email, curso, modulo, valor })
      });

      const insertText = await insertResp.text();
      console.log("DEBUG: supabase status", insertResp.status);
      console.log("DEBUG: supabase body", insertText);

      if (!insertResp.ok) {
        return json(500, { error: "Erro ao salvar inscrição no banco.", details: safeJson(insertText) });
      }

      const insertJson = safeJson(insertText);
      inscricao = insertJson?.[0] || null;

    } catch (e) {
      console.log("DEBUG: supabase fetch failed", String(e));
      return json(500, { error: "Falha ao conectar no Supabase.", details: String(e) });
    }

    // 2) Criar checkout no Mercado Pago (Checkout Pro)
    let mpJson = null;
    try {
      console.log("DEBUG: mercadopago create preference");

      const mpResp = await fetch("https://api.mercadopago.com/checkout/preferences", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MP_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          items: [
            {
              title: `${curso} – ${modulo}`,
              quantity: 1,
              unit_price: valor
            }
          ],
          payer: { name: nome, email },
          back_urls: {
            success: `${SITE_URL}/sucesso.html`,
            failure: `${SITE_URL}/erro.html`,
            pending: `${SITE_URL}/erro.html`
          },
          auto_return: "approved"
        })
      });

      const mpText = await mpResp.text();
      console.log("DEBUG: mercadopago status", mpResp.status);
      console.log("DEBUG: mercadopago body", mpText);

      if (!mpResp.ok) {
        return json(500, { error: "Erro ao criar checkout no Mercado Pago.", details: safeJson(mpText) });
      }

      mpJson = safeJson(mpText);

    } catch (e) {
      console.log("DEBUG: mercadopago fetch failed", String(e));
      return json(500, { error: "Falha ao conectar no Mercado Pago.", details: String(e) });
    }

    // 3) Atualizar inscrição com preference_id (não bloqueia o fluxo)
    if (inscricao?.id && mpJson?.id) {
      try {
        console.log("DEBUG: supabase patch preference_id", { inscricaoId: inscricao.id, prefId: mpJson.id });

        const patchResp = await fetch(`${SUPABASE_URL}/rest/v1/inscricoes?id=eq.${inscricao.id}`, {
          method: "PATCH",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ mercadopago_preference_id: mpJson.id })
        });

        console.log("DEBUG: supabase patch status", patchResp.status);
      } catch (e) {
        console.log("DEBUG: supabase patch failed (non-blocking)", String(e));
        // Não retorna erro aqui pra não impedir o checkout
      }
    }

    console.log("DEBUG: success", {
      ms: Date.now() - startedAt,
      checkout: !!mpJson?.init_point
    });

    return json(200, { checkoutUrl: mpJson.init_point });

  } catch (err) {
    console.log("DEBUG: handler error", String(err));
    return json(500, { error: "Erro interno", details: String(err) });
  }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
