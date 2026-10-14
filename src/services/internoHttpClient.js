// @ts-check
// Cliente HTTP das rotas internas (`/interno/*`) do apice-gestao-back, base do comandax_crm_wa_back.
// Toda escrita do wa-back passa por aqui: POST JSON com o token de serviço no header
// `X-Internal-Token` e o `hash_empresa` no body. Usa o `fetch` nativo do Node 22.
//
// Qualquer falha (configuração, rede, timeout, HTTP não-2xx) vira um `ErroRotaInterna` rejeitado:
// quem chama decide o que fazer (registrar, tentar de novo), e o processo nunca cai por isso.

/** Prazo padrão de uma chamada ao back, sobrescrito por `CRM_BACK_TIMEOUT_MS`. */
const TIMEOUT_PADRAO_MS = 10 * 1000;
/** Tamanho máximo do trecho da resposta de erro guardado no `ErroRotaInterna`. */
const MAX_DETALHE = 500;

/** @typedef {"configuracao" | "requisicao_invalida" | "rede" | "timeout" | "http"} TipoErroRotaInterna */

class ErroRotaInterna extends Error {
  /**
   * @param {string} mensagem
   * @param {{ rota: string, tipo: TipoErroRotaInterna, status?: number | null, detalhe?: string, cause?: unknown }} dados
   */
  constructor(mensagem, { rota, tipo, status = null, detalhe = "", cause }) {
    super(mensagem, cause === undefined ? undefined : { cause });
    this.name = "ErroRotaInterna";
    this.rota = rota;
    this.tipo = tipo;
    /** @type {number | null} */
    this.status = status;
    this.detalhe = detalhe;
  }
}

/**
 * Único ponto de leitura do token de serviço (wa-back → back).
 * @returns {string}
 */
function obterTokenServico() {
  return process.env.CRM_BACK_SERVICE_TOKEN || "";
}

/** @returns {number} */
function obterTimeoutMs() {
  const valor = Number(process.env.CRM_BACK_TIMEOUT_MS);
  return Number.isFinite(valor) && valor > 0 ? valor : TIMEOUT_PADRAO_MS;
}

/**
 * @param {string} rota caminho começando com `/`, ex.: `/interno/mensagem`
 * @returns {string}
 */
function montarUrl(rota) {
  const baseUrl = process.env.CRM_BACK_URL;
  if (!baseUrl) {
    throw new ErroRotaInterna("Variável de ambiente CRM_BACK_URL não configurada.", { rota, tipo: "configuracao" });
  }
  return `${baseUrl.replace(/\/+$/, "")}${rota}`;
}

/**
 * @param {unknown} erro
 * @returns {boolean}
 */
function ehTimeout(erro) {
  return erro instanceof Error && (erro.name === "TimeoutError" || erro.name === "AbortError");
}

/**
 * Faz um POST autenticado numa rota interna do back e devolve o corpo JSON (ou `null` sem corpo).
 * @template {{ hash_empresa: string }} C
 * @param {string} rota
 * @param {C} corpo precisa trazer o `hash_empresa` do tenant (escopo de toda escrita no back)
 * @returns {Promise<any>}
 * @throws {ErroRotaInterna}
 */
async function chamarRotaInterna(rota, corpo) {
  if (!corpo || typeof corpo.hash_empresa !== "string" || corpo.hash_empresa.trim() === "") {
    throw new ErroRotaInterna(`Chamada a "${rota}" sem hash_empresa no corpo.`, { rota, tipo: "requisicao_invalida" });
  }
  const url = montarUrl(rota);

  /** @type {Response} */
  let resposta;
  try {
    resposta = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": obterTokenServico(),
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(obterTimeoutMs()),
    });
  } catch (erro) {
    if (ehTimeout(erro)) {
      throw new ErroRotaInterna(`Tempo esgotado ao chamar "${rota}" no back.`, { rota, tipo: "timeout", cause: erro });
    }
    const motivo = erro instanceof Error ? erro.message : String(erro);
    throw new ErroRotaInterna(`Falha de rede ao chamar "${rota}" no back: ${motivo}`, { rota, tipo: "rede", cause: erro });
  }

  if (!resposta.ok) {
    const detalhe = await resposta.text().catch(() => "");
    throw new ErroRotaInterna(`Erro ao chamar "${rota}" no back (HTTP ${resposta.status}).`, {
      rota,
      tipo: "http",
      status: resposta.status,
      detalhe: detalhe.slice(0, MAX_DETALHE),
    });
  }

  let texto;
  try {
    texto = await resposta.text();
  } catch (erro) {
    throw new ErroRotaInterna(`Falha ao ler a resposta de "${rota}" no back.`, { rota, tipo: ehTimeout(erro) ? "timeout" : "rede", cause: erro });
  }
  if (texto === "") return null;
  try {
    return JSON.parse(texto);
  } catch (erro) {
    throw new ErroRotaInterna(`Resposta inválida (não é JSON) de "${rota}" no back.`, {
      rota,
      tipo: "http",
      status: resposta.status,
      cause: erro,
    });
  }
}

module.exports = { chamarRotaInterna, montarUrl, obterTokenServico, ErroRotaInterna };
