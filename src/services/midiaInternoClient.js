// @ts-check
// Cliente da rota interna que recebe o binário da mídia de uma mensagem recebida
// (`POST /interno/midia`, multipart/form-data) no apice-gestao-back, onde é lida com multer
// memoryStorage (`upload.single("midia")`). Base: `enviarMidiaInteracao` do comandax_crm_wa_back.
// A rota é criada no back na Task 5.1; até lá a chamada falha com `ErroRotaInterna` e quem chama
// (o BaileysAdapter) só registra a falha no log.
//
// Contrato do multipart (os campos de texto vão ANTES do arquivo: o multer só preenche `req.body`
// com o que chegou antes do arquivo):
// - `hash_empresa`, `cod_equipe`, `mensagem_wa_id`: tenant, equipe e mensagem já registrada em
//   `/interno/mensagem-recebida` (a mídia é associada pelo `mensagem_wa_id`);
// - `mimetype`: tipo DETECTADO pelo conteúdo (magic bytes), não o declarado pelo remetente;
// - `tamanho_bytes`: tamanho real do buffer;
// - `nome_arquivo` (opcional): nome declarado, em UTF-8 (o `originalname` do multer chega em latin1);
// - `duracao_segundos` (opcional): real no OGG/Opus, declarada nos demais;
// - `midia`: o arquivo, com Content-Type = `mimetype` e nome fixo `midia`.
const { chamarRotaInternaMultipart, ErroRotaInterna } = require("./internoHttpClient");

const ROTA = "/interno/midia";

/**
 * @typedef {{
 *   hash_empresa: string,
 *   cod_equipe: string | number,
 *   mimetype: string,
 *   tamanho_bytes: number,
 *   nome_arquivo: string | null,
 *   duracao_segundos: number | null,
 * }} MetadadosEnvioMidia
 */

/**
 * Envia ao back o binário validado da mídia de uma mensagem recebida, só em memória.
 * Rejeita com `ErroRotaInterna` (requisição inválida, configuração, rede, prazo ou HTTP não-2xx).
 * @param {string} mensagem_wa_id
 * @param {Buffer} buffer
 * @param {MetadadosEnvioMidia} metadados
 * @returns {Promise<any>}
 */
async function enviarMidia(mensagem_wa_id, buffer, metadados) {
  if (typeof mensagem_wa_id !== "string" || mensagem_wa_id === "") {
    throw new ErroRotaInterna(`Chamada a "${ROTA}" sem mensagem_wa_id.`, { rota: ROTA, tipo: "requisicao_invalida" });
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ErroRotaInterna(`Chamada a "${ROTA}" sem o conteúdo da mídia.`, { rota: ROTA, tipo: "requisicao_invalida" });
  }

  const formulario = new FormData();
  formulario.append("hash_empresa", metadados.hash_empresa ?? "");
  formulario.append("cod_equipe", String(metadados.cod_equipe));
  formulario.append("mensagem_wa_id", mensagem_wa_id);
  formulario.append("mimetype", metadados.mimetype);
  formulario.append("tamanho_bytes", String(metadados.tamanho_bytes));
  if (metadados.nome_arquivo) formulario.append("nome_arquivo", metadados.nome_arquivo);
  if (typeof metadados.duracao_segundos === "number") formulario.append("duracao_segundos", String(metadados.duracao_segundos));
  formulario.append("midia", new Blob([buffer], { type: metadados.mimetype }), "midia");

  return chamarRotaInternaMultipart(ROTA, formulario);
}

module.exports = { enviarMidia };
