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
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Método não permitido. Use POST." });
    }

    const data = JSON.parse(event.body || "{}");
    const { nome, whatsapp, email, curso, modulo } = data;

    if (!nome || !whatsapp || !email || !curso || !modulo) {
      return json(400, { error: "Dados incompletos" });
    }

    const valor = PRECOS[modulo];
    if (!valor) return json(400, { error: "Módulo inválido" });

    if (!SUPABASE_URL || !SUPABASE_KEY || !MP_TOKEN || !SITE_URL) {
      return json(500, { error: "Variáveis de ambiente não configuradas no Netlify." });
    }

    // 1) Salvar no Supabase
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

    const insertJson = await insertResp.json();
    if (!insertResp.ok) {
      return json(500, { error: "Erro ao salvar inscrição no banco.", details: insertJson });
    }

    const inscricao = insertJson?.[0];

    // 2) Criar checkout no Mercado Pago (Checkout Pro)
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

    const mpJson = await mpResp.json();
    if (!mpResp.ok) {
      return json(500, { error: "Erro ao criar checkout no Mercado Pago.", details: mpJson });
    }

    // 3) Atualizar inscrição com preference_id
    if (inscricao?.id) {
      await fetch(`${SUPABASE_URL}/rest/v1/inscricoes?id=eq.${inscricao.id}`, {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ mercadopago_preference_id: mpJson.id })
      });
    }

    return json(200, { checkoutUrl: mpJson.init_point });

  } catch (err) {
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
