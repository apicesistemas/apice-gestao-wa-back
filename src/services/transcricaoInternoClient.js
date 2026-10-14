// @ts-check
// Cliente da rota interna que recebe o resultado da transcrição de um áudio ou vídeo recebido
// (`POST /interno/transcricao`) no apice-gestao-back. A rota é criada no back na Task 6.1; até lá
// a chamada falha com `ErroRotaInterna` e quem chama (a filaTranscricao) só registra no log.
//
// Contrato (JSON):
// - `hash_empresa`, `cod_equipe` (número): tenant e equipe da instância que recebeu;
// - `mensagem_wa_id`: a mensagem já registrada em `/interno/mensagem-recebida`;
// - `status`: `CONCLUIDA` (com texto), `PENDENTE` (falha transitória da MiniMax, como 429 ou prazo,
//   depois da nova tentativa, ou chave não configurada) ou `FALHOU` (erro definitivo: formato não
//   suportado, vídeo sem áudio, acima dos limites da API, recusa da API, transcrição vazia);
// - `texto`: a transcrição em `CONCLUIDA`, `null` nos demais.
// A transcrição é conteúdo interno: visível só ao suporte e nunca enviada ao WhatsApp.
const { chamarRotaInterna, ErroRotaInterna } = require("./internoHttpClient");

const ROTA = "/interno/transcricao";
const STATUS = new Set(["CONCLUIDA", "PENDENTE", "FALHOU"]);

/** @typedef {"CONCLUIDA" | "PENDENTE" | "FALHOU"} StatusTranscricao */
/** @typedef {{ status: StatusTranscricao, texto?: string | null }} ResultadoRegistroTranscricao */
/** @typedef {import("./mensagemInternoClient").ContextoInstancia} ContextoInstancia */

/** @param {string} mensagem */
const requisicaoInvalida = (mensagem) => new ErroRotaInterna(mensagem, { rota: ROTA, tipo: "requisicao_invalida" });

/**
 * Registra no back o resultado da transcrição de uma mensagem recebida.
 * Rejeita com `ErroRotaInterna` (requisição inválida, configuração, rede, prazo ou HTTP não-2xx).
 * @param {string} mensagem_wa_id
 * @param {ResultadoRegistroTranscricao} resultado `texto` só vale em `CONCLUIDA`
 * @param {ContextoInstancia} contexto
 * @returns {Promise<any>}
 */
async function registrarTranscricao(mensagem_wa_id, { status, texto = null }, { hash_empresa, cod_equipe }) {
  if (typeof mensagem_wa_id !== "string" || mensagem_wa_id === "") throw requisicaoInvalida(`Chamada a "${ROTA}" sem mensagem_wa_id.`);
  if (!STATUS.has(status)) throw requisicaoInvalida(`Chamada a "${ROTA}" com status de transcrição inválido.`);
  const textoFinal = status === "CONCLUIDA" && typeof texto === "string" ? texto.trim() : null;
  if (status === "CONCLUIDA" && !textoFinal) throw requisicaoInvalida(`Chamada a "${ROTA}" concluída sem texto.`);

  return chamarRotaInterna(ROTA, {
    hash_empresa,
    cod_equipe: Number(cod_equipe),
    mensagem_wa_id,
    status,
    texto: textoFinal,
  });
}

module.exports = { registrarTranscricao };
