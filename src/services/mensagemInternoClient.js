// @ts-check
// Cliente da rota interna de registro das mensagens recebidas (`POST /interno/mensagem-recebida`)
// no apice-gestao-back. A rota é criada no back na Task 6.1; até lá a chamada falha com
// `ErroRotaInterna` e quem chama (o BaileysAdapter) só registra a falha no log.
const { chamarRotaInterna } = require("./internoHttpClient");

/** @typedef {import("../whatsapp/filtroEntrada").MensagemRecebida} MensagemRecebida */
/** @typedef {{ hash_empresa: string, cod_equipe: string | number }} ContextoInstancia */
/**
 * Um item por JID de `mencoes` (mesma ordem), com o par LID ↔ telefone conhecido (Task 17.1).
 * `jid` até 100 caracteres; `lid` /^d{1,25}@lid$/ ou null; `telefone` /^d{8,15}$/ ou null (sem par
 * conhecido a mensagem é registrada normalmente); `propria` é true quando o mencionado é o número da equipe.
 * @typedef {{ jid: string, lid: string | null, telefone: string | null, propria: boolean }} MencaoDetalhe
 */
/**
 * A MensagemRecebida com o `nome_chat` (subject do grupo, Task 6.2). Só vai em mensagem de grupo e
 * quando o subject foi obtido; ausente no privado (o back usa o nome do contato).
 * `mencoes_detalhe` (opcional, Task 17.1) só vai quando a mensagem tem menções; `mencoes` não muda.
 * A edição (tipo EDICAO) também sai por `/interno/mensagem-recebida`, com as menções do texto novo.
 * @typedef {MensagemRecebida & { nome_chat?: string, mencoes_detalhe?: MencaoDetalhe[] }} MensagemParaRegistro
 */
/** @typedef {import("../whatsapp/midiaEntrada").MotivoPendenciaMidia} MotivoPendenciaMidia */
/**
 * Estado do binário da mídia no momento do registro. `midia_pendente: true` quando a mensagem tem
 * mídia mas o binário NÃO vai seguir em `/interno/midia`; o motivo diz se foi falha transitória
 * (`DOWNLOAD_FALHOU`, `PRAZO_ESGOTADO`) ou recusa (`ACIMA_DO_TETO`, `TIPO_NAO_RECONHECIDO`,
 * `TIPO_DIVERGENTE`, `MIDIA_VAZIA`).
 * @typedef {{ midia_pendente: boolean, midia_motivo_pendencia: MotivoPendenciaMidia | null }} EstadoMidia
 */

/** @type {EstadoMidia} */
const SEM_PENDENCIA = Object.freeze({ midia_pendente: false, midia_motivo_pendencia: null });

/**
 * Envia ao back a MensagemRecebida normalizada, com o tenant e a equipe da instância que recebeu.
 * `hash_empresa` e `cod_equipe` vêm da instância e não podem ser sobrescritos pela mensagem.
 * Rejeita com `ErroRotaInterna` (configuração, rede, prazo ou HTTP não-2xx).
 * @param {MensagemParaRegistro} mensagem
 * @param {ContextoInstancia} contexto
 * @param {EstadoMidia} [estadoMidia] padrão: sem pendência
 * @returns {Promise<any>}
 */
function registrarMensagem(mensagem, { hash_empresa, cod_equipe }, estadoMidia = SEM_PENDENCIA) {
  return chamarRotaInterna("/interno/mensagem-recebida", {
    ...mensagem,
    hash_empresa,
    cod_equipe: Number(cod_equipe),
    midia_pendente: estadoMidia.midia_pendente === true,
    midia_motivo_pendencia: estadoMidia.midia_pendente === true ? estadoMidia.midia_motivo_pendencia ?? null : null,
  });
}

module.exports = { registrarMensagem, SEM_PENDENCIA };
